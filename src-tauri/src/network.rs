//! Wired (LAN) link and Internet reachability for the notch controls panel.

use serde::Serialize;
use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
use windows::Win32::Networking::NetworkListManager::{INetworkListManager, NetworkListManager};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
};

/// `IF_TYPE_ETHERNET_CSMACD`: wired Ethernet adapters (Wi-Fi is a different type).
const IF_TYPE_ETHERNET: u32 = 6;

#[derive(Serialize)]
pub struct NetworkStatus {
    /// A physical Ethernet adapter has a live link (cable plugged in).
    pub lan_connected: bool,
    /// Windows' network awareness says traffic can reach the Internet, over any adapter.
    pub internet: bool,
    pub lan_name: Option<String>,
}

fn lan_adapter() -> Option<String> {
    unsafe {
        let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
        if GetIfTable2(&mut table).is_err() || table.is_null() {
            return None;
        }
        let rows =
            std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        let found = rows.iter().find(|row| {
            // Bit 0 of the interface flags is HardwareInterface: skips VPN and
            // virtual-switch adapters, which also report as Ethernet.
            row.Type == IF_TYPE_ETHERNET
                && row.OperStatus == IfOperStatusUp
                && row.InterfaceAndOperStatusFlags._bitfield & 1 != 0
        });
        let name = found.map(|row| {
            let len = row
                .Alias
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(row.Alias.len());
            String::from_utf16_lossy(&row.Alias[..len])
        });
        FreeMibTable(table as *const _);
        name
    }
}

#[tauri::command]
pub async fn get_network_status() -> NetworkStatus {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        let com = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let internet =
            CoCreateInstance::<_, INetworkListManager>(&NetworkListManager, None, CLSCTX_ALL)
                .and_then(|manager| manager.IsConnectedToInternet())
                .map(|connected| connected.as_bool())
                .unwrap_or(false);
        if com {
            CoUninitialize();
        }
        let lan_name = lan_adapter();
        NetworkStatus {
            lan_connected: lan_name.is_some(),
            internet,
            lan_name,
        }
    })
    .await
    .unwrap_or(NetworkStatus {
        lan_connected: false,
        internet: false,
        lan_name: None,
    })
}

/// Opens the classic "Network Connections" control panel with every adapter.
#[tauri::command]
pub fn open_network_connections() {
    unsafe {
        use windows::Win32::UI::Shell::ShellExecuteA;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let _ = ShellExecuteA(
            None,
            windows::core::PCSTR(c"open".as_ptr() as *const u8),
            windows::core::PCSTR(c"ncpa.cpl".as_ptr() as *const u8),
            windows::core::PCSTR::null(),
            windows::core::PCSTR::null(),
            SW_SHOWNORMAL,
        );
    }
}
