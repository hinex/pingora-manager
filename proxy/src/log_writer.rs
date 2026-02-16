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

        let writer = writers.entry(entry.file_path.clone()).or_insert_with(|| {
            let file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&entry.file_path)
                .expect("Failed to open log file");
            BufWriter::with_capacity(8192, file)
        });

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
