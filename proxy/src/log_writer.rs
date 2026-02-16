use std::collections::HashMap;
use std::fs::{OpenOptions, File};
use std::io::{BufWriter, Write};
use tokio::sync::mpsc;

pub struct LogEntry {
    pub file_path: String,
    pub line: String,
}

pub type LogSender = mpsc::UnboundedSender<LogEntry>;

pub fn create_log_channel() -> (LogSender, mpsc::UnboundedReceiver<LogEntry>) {
    mpsc::unbounded_channel()
}

pub async fn run_log_writer(mut rx: mpsc::UnboundedReceiver<LogEntry>) {
    let mut writers: HashMap<String, BufWriter<File>> = HashMap::new();
    let mut count = 0u32;

    loop {
        let entry = tokio::select! {
            entry = rx.recv() => {
                match entry {
                    Some(e) => e,
                    None => break, // channel closed
                }
            }
            _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {
                // Periodic flush
                for w in writers.values_mut() {
                    let _ = w.flush();
                }
                count = 0;
                continue;
            }
        };

        let writer = match writers.entry(entry.file_path.clone()) {
            std::collections::hash_map::Entry::Occupied(e) => e.into_mut(),
            std::collections::hash_map::Entry::Vacant(e) => {
                // Ensure parent directory exists before opening the log file
                if let Some(parent) = std::path::Path::new(&entry.file_path).parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&entry.file_path)
                {
                    Ok(file) => e.insert(BufWriter::with_capacity(8192, file)),
                    Err(err) => {
                        eprintln!("Failed to open log file {}: {}", entry.file_path, err);
                        continue;
                    }
                }
            }
        };

        let _ = writer.write_all(entry.line.as_bytes());
        count += 1;

        if count >= 64 {
            for w in writers.values_mut() {
                let _ = w.flush();
            }
            count = 0;
        }
    }

    // Final flush on shutdown
    for w in writers.values_mut() {
        let _ = w.flush();
    }
}
