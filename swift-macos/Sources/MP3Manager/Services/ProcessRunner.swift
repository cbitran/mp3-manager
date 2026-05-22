import Foundation

enum ProcessRunner {
    static func run(
        _ executablePath: String,
        arguments: [String],
        timeout: TimeInterval = 10
    ) async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            let outPipe = Pipe()
            let errPipe = Pipe()

            process.executableURL = URL(fileURLWithPath: executablePath)
            process.arguments = arguments
            process.standardOutput = outPipe
            process.standardError = errPipe

            var resumed = false
            let lock = NSLock()

            func resume(with result: Result<String, Error>) {
                lock.lock()
                defer { lock.unlock() }
                guard !resumed else { return }
                resumed = true
                switch result {
                case .success(let s): continuation.resume(returning: s)
                case .failure(let e): continuation.resume(throwing: e)
                }
            }

            process.terminationHandler = { p in
                let data = outPipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8) ?? ""
                if p.terminationStatus == 0 {
                    resume(with: .success(output))
                } else {
                    let errData = errPipe.fileHandleForReading.readDataToEndOfFile()
                    let errMsg = String(data: errData, encoding: .utf8) ?? "Erro desconhecido"
                    resume(with: .failure(NSError(
                        domain: "ProcessRunner",
                        code: Int(p.terminationStatus),
                        userInfo: [NSLocalizedDescriptionKey: errMsg]
                    )))
                }
            }

            do {
                try process.run()
            } catch {
                resume(with: .failure(error))
                return
            }

            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                if process.isRunning {
                    process.terminate()
                    resume(with: .failure(NSError(
                        domain: "ProcessRunner",
                        code: -1,
                        userInfo: [NSLocalizedDescriptionKey: "Timeout após \(Int(timeout))s — arquivo ignorado"]
                    )))
                }
            }
        }
    }
}
