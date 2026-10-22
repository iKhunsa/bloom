//! GPU utilization for the notch's GPU widget, read from the same
//! `GPU Engine` performance counters Task Manager uses.

use std::collections::HashMap;
use std::sync::Mutex;
use windows::core::w;
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhOpenQueryW,
    PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
};

/// Open PDH query and counter handles (as addresses, so the static is Sync), kept
/// between calls: utilization is a rate,
/// so each read needs the previous sample to measure against.
static QUERY: Mutex<Option<(usize, usize)>> = Mutex::new(None);

fn usage_sync() -> Result<u32, String> {
    let mut guard = QUERY.lock().map_err(|e| e.to_string())?;
    unsafe {
        let (query, counter) = match *guard {
            Some((q, c)) => (PDH_HQUERY(q as *mut _), PDH_HCOUNTER(c as *mut _)),
            None => {
                let mut query = PDH_HQUERY::default();
                if PdhOpenQueryW(None, 0, &mut query) != 0 {
                    return Err("could not open the performance query".into());
                }
                let mut counter = PDH_HCOUNTER::default();
                if PdhAddEnglishCounterW(
                    query,
                    w!("\\GPU Engine(*)\\Utilization Percentage"),
                    0,
                    &mut counter,
                ) != 0
                {
                    return Err("no GPU performance counters on this PC".into());
                }
                *guard = Some((query.0 as usize, counter.0 as usize));
                (query, counter)
            }
        };

        if PdhCollectQueryData(query) != 0 {
            return Err("could not sample the GPU counters".into());
        }

        // Ask for the size first, then read every engine instance.
        let mut size = 0u32;
        let mut count = 0u32;
        let status =
            PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None);
        if status != PDH_MORE_DATA || size == 0 {
            // The first sample has nothing to compare with yet.
            return Ok(0);
        }
        let mut buffer = vec![0u8; size as usize];
        let items = buffer.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        if PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items))
            != 0
        {
            return Ok(0);
        }

        // Engines are per process. Add them up per GPU and engine type, then take
        // the busiest one, which is what Task Manager graphs for a GPU.
        let mut busy: HashMap<String, f64> = HashMap::new();
        for item in std::slice::from_raw_parts(items, count as usize) {
            let name = item.szName.to_string().unwrap_or_default();
            let (Some(luid), Some(engtype)) = (
                name.split("_luid_")
                    .nth(1)
                    .and_then(|s| s.split("_phys").next()),
                name.split("_engtype_").nth(1),
            ) else {
                continue;
            };
            *busy.entry(format!("{luid}/{engtype}")).or_default() +=
                item.FmtValue.Anonymous.doubleValue;
        }
        Ok(busy
            .values()
            .fold(0.0f64, |a, &b| a.max(b))
            .round()
            .min(100.0) as u32)
    }
}

#[tauri::command]
pub async fn get_gpu_usage() -> Result<u32, String> {
    tauri::async_runtime::spawn_blocking(usage_sync)
        .await
        .map_err(|e| e.to_string())?
}
