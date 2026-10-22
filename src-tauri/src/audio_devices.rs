//! Audio endpoint selection and microphone gain for the notch controls panel.

// The COM interface below keeps Windows' PascalCase method names.
#![allow(non_snake_case)]

use serde::Serialize;
use std::ffi::c_void;
use windows::core::{interface, IUnknown, IUnknown_Vtbl, GUID, HRESULT, HSTRING, PCWSTR};
use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
use windows::Win32::Media::Audio::{
    eCapture, eCommunications, eConsole, eMultimedia, eRender, EDataFlow, ERole, IMMDevice,
    IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
    COINIT_MULTITHREADED, STGM_READ,
};

/// Windows' undocumented policy-config COM interface, the only way to change the
/// default audio device. Only `SetDefaultEndpoint` is called; the other methods
/// exist to keep the vtable layout right, so their signatures are placeholders.
#[interface("f8679f50-850a-41cf-9c72-430f290290c8")]
unsafe trait IPolicyConfig: IUnknown {
    unsafe fn GetMixFormat(&self, device: PCWSTR, format: *mut *mut c_void) -> HRESULT;
    unsafe fn GetDeviceFormat(
        &self,
        device: PCWSTR,
        default: i32,
        format: *mut *mut c_void,
    ) -> HRESULT;
    unsafe fn ResetDeviceFormat(&self, device: PCWSTR) -> HRESULT;
    unsafe fn SetDeviceFormat(
        &self,
        device: PCWSTR,
        endpoint_format: *mut c_void,
        mix_format: *mut c_void,
    ) -> HRESULT;
    unsafe fn GetProcessingPeriod(
        &self,
        device: PCWSTR,
        default: i32,
        default_period: *mut i64,
        min_period: *mut i64,
    ) -> HRESULT;
    unsafe fn SetProcessingPeriod(&self, device: PCWSTR, period: *mut i64) -> HRESULT;
    unsafe fn GetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    unsafe fn SetShareMode(&self, device: PCWSTR, mode: *mut c_void) -> HRESULT;
    unsafe fn GetPropertyValue(
        &self,
        device: PCWSTR,
        key: *const c_void,
        value: *mut c_void,
    ) -> HRESULT;
    unsafe fn SetPropertyValue(
        &self,
        device: PCWSTR,
        key: *const c_void,
        value: *mut c_void,
    ) -> HRESULT;
    unsafe fn SetDefaultEndpoint(&self, device: PCWSTR, role: ERole) -> HRESULT;
    unsafe fn SetEndpointVisibility(&self, device: PCWSTR, visible: i32) -> HRESULT;
}

/// CLSID of the `CPolicyConfigClient` coclass.
const POLICY_CONFIG_CLIENT: GUID = GUID::from_u128(0x870af99c_171d_4f9e_af0d_e63df40c2bc9);

#[derive(Serialize)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Serialize)]
pub struct MicState {
    pub id: String,
    pub name: String,
    /// Input gain of the default microphone, 0.0 to 1.0.
    pub level: f32,
    pub muted: bool,
}

/// Balances `CoInitializeEx` on the blocking worker thread.
struct Com(bool);

impl Com {
    fn new() -> Self {
        Com(unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok())
    }
}

impl Drop for Com {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

fn flow(kind: &str) -> EDataFlow {
    if kind == "input" {
        eCapture
    } else {
        eRender
    }
}

unsafe fn enumerator() -> Result<IMMDeviceEnumerator, String> {
    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())
}

unsafe fn device_id(device: &IMMDevice) -> Option<String> {
    let id = device.GetId().ok()?;
    let text = id.to_string().ok();
    CoTaskMemFree(Some(id.0 as *const _));
    text
}

unsafe fn device_name(device: &IMMDevice) -> String {
    let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
        return String::new();
    };
    let Ok(mut value) = store.GetValue(&PKEY_Device_FriendlyName) else {
        return String::new();
    };
    let name = PropVariantToStringAlloc(&value)
        .ok()
        .map(|text| {
            let s = String::from_utf16_lossy(text.as_wide());
            CoTaskMemFree(Some(text.0 as *const _));
            s
        })
        .unwrap_or_default();
    let _ = PropVariantClear(&mut value);
    name
}

/// Active playback ("output") or recording ("input") devices.
#[tauri::command]
pub async fn audio_list_devices(kind: String) -> Result<Vec<AudioDevice>, String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        let _com = Com::new();
        let enumerator = enumerator()?;
        let flow = flow(&kind);
        let default_id = enumerator
            .GetDefaultAudioEndpoint(flow, eConsole)
            .ok()
            .and_then(|d| device_id(&d));
        let devices = enumerator
            .EnumAudioEndpoints(flow, DEVICE_STATE_ACTIVE)
            .map_err(|e| e.to_string())?;
        let mut list = Vec::new();
        for i in 0..devices.GetCount().unwrap_or(0) {
            let Ok(device) = devices.Item(i) else {
                continue;
            };
            let Some(id) = device_id(&device) else {
                continue;
            };
            list.push(AudioDevice {
                name: device_name(&device),
                is_default: default_id.as_deref() == Some(id.as_str()),
                id,
            });
        }
        Ok(list)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Makes the device the default for every role, like the Sound settings page.
#[tauri::command]
pub async fn audio_set_default_device(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        let _com = Com::new();
        let policy: IPolicyConfig =
            CoCreateInstance(&POLICY_CONFIG_CLIENT, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let id = HSTRING::from(id);
        for role in [eConsole, eMultimedia, eCommunications] {
            policy
                .SetDefaultEndpoint(PCWSTR(id.as_ptr()), role)
                .ok()
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

unsafe fn default_mic() -> Result<(IMMDevice, IAudioEndpointVolume), String> {
    let device = enumerator()?
        .GetDefaultAudioEndpoint(eCapture, eConsole)
        .map_err(|e| e.to_string())?;
    let volume: IAudioEndpointVolume = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| e.to_string())?;
    Ok((device, volume))
}

/// Input gain of the current default microphone. Each device keeps its own
/// level in Windows, so switching microphones just returns another one's.
#[tauri::command]
pub async fn get_mic_state() -> Result<MicState, String> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        let _com = Com::new();
        let (device, volume) = default_mic()?;
        Ok(MicState {
            id: device_id(&device).unwrap_or_default(),
            name: device_name(&device),
            level: volume
                .GetMasterVolumeLevelScalar()
                .map_err(|e| e.to_string())?,
            muted: volume.GetMute().map(|m| m.as_bool()).unwrap_or(false),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn set_mic_level(level: f32) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unsafe {
        let _com = Com::new();
        let (_, volume) = default_mic()?;
        volume
            .SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
