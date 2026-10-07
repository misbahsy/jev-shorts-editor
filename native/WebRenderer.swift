import AppKit
import AVFoundation
import CoreImage
import CoreVideo
import Foundation
import Vision
import WebKit

private enum NativeMattingError: LocalizedError {
    case message(String)

    var errorDescription: String? {
        switch self { case .message(let message): return message }
    }
}

private func mattingColor(_ hex: String) -> CIColor {
    let clean = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
    guard clean.count == 6, let value = Int(clean, radix: 16) else {
        return CIColor(red: 0, green: 177 / 255, blue: 64 / 255, alpha: 1)
    }
    return CIColor(
        red: CGFloat((value >> 16) & 0xff) / 255,
        green: CGFloat((value >> 8) & 0xff) / 255,
        blue: CGFloat(value & 0xff) / 255,
        alpha: 1
    )
}

private func renderNativeMatteVideo(
    sourcePath: String,
    outputPath: String,
    width: Int,
    height: Int,
    mode: String,
    strength: Double,
    color: String
) throws -> Int {
    guard width > 0, height > 0 else { throw NativeMattingError.message("Invalid output dimensions") }
    let sourceURL = URL(fileURLWithPath: sourcePath)
    let outputURL = URL(fileURLWithPath: outputPath)
    try? FileManager.default.removeItem(at: outputURL)

    let asset = AVURLAsset(url: sourceURL)
    guard let track = asset.tracks(withMediaType: .video).first else {
        throw NativeMattingError.message("The source has no video track")
    }
    let reader = try AVAssetReader(asset: asset)
    let readerOutput = AVAssetReaderTrackOutput(
        track: track,
        outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    readerOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(readerOutput) else { throw NativeMattingError.message("Could not decode the source video") }
    reader.add(readerOutput)

    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    let writerInput = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: width,
        AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [
            AVVideoAverageBitRateKey: max(2_000_000, width * height * 5),
            AVVideoExpectedSourceFrameRateKey: max(1, Int(round(track.nominalFrameRate))),
            AVVideoMaxKeyFrameIntervalKey: max(1, Int(round(track.nominalFrameRate)) * 2),
        ],
    ])
    writerInput.expectsMediaDataInRealTime = false
    let adaptor = AVAssetWriterInputPixelBufferAdaptor(
        assetWriterInput: writerInput,
        sourcePixelBufferAttributes: [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey as String: width,
            kCVPixelBufferHeightKey as String: height,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:],
        ]
    )
    guard writer.canAdd(writerInput) else { throw NativeMattingError.message("Could not configure the matte encoder") }
    writer.add(writerInput)
    guard writer.startWriting() else {
        throw writer.error ?? NativeMattingError.message("Could not start the matte encoder")
    }
    writer.startSession(atSourceTime: .zero)
    guard reader.startReading() else {
        writer.cancelWriting()
        throw reader.error ?? NativeMattingError.message("Could not start decoding the source")
    }

    let request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = .balanced
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    let context = CIContext(options: [.cacheIntermediates: false])
    let targetRect = CGRect(x: 0, y: 0, width: width, height: height)
    let outputColorSpace = CGColorSpaceCreateDeviceRGB()
    var frameCount = 0

    while let sample = readerOutput.copyNextSampleBuffer() {
        guard let sourceBuffer = CMSampleBufferGetImageBuffer(sample) else { continue }
        while !writerInput.isReadyForMoreMediaData {
            if writer.status == .failed {
                throw writer.error ?? NativeMattingError.message("The matte encoder failed")
            }
            Thread.sleep(forTimeInterval: 0.002)
        }
        guard let pool = adaptor.pixelBufferPool else {
            throw NativeMattingError.message("The matte encoder did not create a pixel buffer pool")
        }
        var destinationBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &destinationBuffer) == kCVReturnSuccess,
              let destinationBuffer else {
            throw NativeMattingError.message("Could not allocate a matte frame")
        }

        let handler = VNImageRequestHandler(cvPixelBuffer: sourceBuffer, orientation: .up)
        try handler.perform([request])
        guard let maskBuffer = request.results?.first?.pixelBuffer else {
            throw NativeMattingError.message("Vision did not return a person mask")
        }

        let sourceImage = CIImage(cvPixelBuffer: sourceBuffer)
        let sourceScale = CGAffineTransform(
            scaleX: targetRect.width / sourceImage.extent.width,
            y: targetRect.height / sourceImage.extent.height
        )
        let foreground = sourceImage.transformed(by: sourceScale).cropped(to: targetRect)
        let maskImage = CIImage(cvPixelBuffer: maskBuffer)
        let maskScale = CGAffineTransform(
            scaleX: targetRect.width / maskImage.extent.width,
            y: targetRect.height / maskImage.extent.height
        )
        let mask = maskImage.transformed(by: maskScale).cropped(to: targetRect)
        let background: CIImage
        if mode == "greenscreen" {
            background = CIImage(color: mattingColor(color)).cropped(to: targetRect)
        } else {
            background = foreground
                .clampedToExtent()
                .applyingFilter("CIGaussianBlur", parameters: [kCIInputRadiusKey: max(4, min(40, strength))])
                .cropped(to: targetRect)
        }
        let composite = foreground.applyingFilter("CIBlendWithMask", parameters: [
            kCIInputBackgroundImageKey: background,
            kCIInputMaskImageKey: mask,
        ]).cropped(to: targetRect)
        context.render(composite, to: destinationBuffer, bounds: targetRect, colorSpace: outputColorSpace)
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sample)
        guard adaptor.append(destinationBuffer, withPresentationTime: presentationTime) else {
            throw writer.error ?? NativeMattingError.message("Could not append a matte frame")
        }
        frameCount += 1
    }

    if reader.status == .failed {
        writer.cancelWriting()
        throw reader.error ?? NativeMattingError.message("Source decoding failed")
    }
    writerInput.markAsFinished()
    let completion = DispatchSemaphore(value: 0)
    writer.finishWriting { completion.signal() }
    completion.wait()
    guard writer.status == .completed else {
        throw writer.error ?? NativeMattingError.message("Matte encoding failed")
    }
    return frameCount
}

private func startNativeMatteVideo(args: [String: Any], completion: @escaping (Result<[String: Any], Error>) -> Void) {
    guard let sourcePath = args["sourcePath"] as? String,
          let outputPath = args["outputPath"] as? String else {
        completion(.failure(NativeMattingError.message("Native matting requires sourcePath and outputPath")))
        return
    }
    let width = args["width"] as? Int ?? 0
    let height = args["height"] as? Int ?? 0
    let mode = args["mode"] as? String ?? "blur"
    let strength = args["strength"] as? Double ?? 18
    let color = args["color"] as? String ?? "#00b140"
    DispatchQueue.global(qos: .userInitiated).async {
        do {
            let frames = try renderNativeMatteVideo(
                sourcePath: sourcePath,
                outputPath: outputPath,
                width: width,
                height: height,
                mode: mode,
                strength: strength,
                color: color
            )
            completion(.success(["frames": frames]))
        } catch {
            completion(.failure(error))
        }
    }
}

private let outputLock = NSLock()

private func writeMessage(_ payload: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload),
          var line = String(data: data, encoding: .utf8) else { return }
    line.append("\n")
    outputLock.lock()
    defer { outputLock.unlock() }
    FileHandle.standardOutput.write(Data(line.utf8))
}

private func reply(_ id: Int, value: Any? = nil) {
    writeMessage(["id": id, "ok": true, "value": value ?? NSNull()])
}

private func reject(_ id: Int, _ error: Error) {
    writeMessage(["id": id, "ok": false, "error": error.localizedDescription])
}

private func reject(_ id: Int, _ message: String) {
    writeMessage(["id": id, "ok": false, "error": message])
}

private func jsonValue(_ value: Any?) -> Any {
    guard let value else { return NSNull() }
    if value is NSNull || value is String || value is NSNumber { return value }
    if let values = value as? [Any] { return values.map(jsonValue) }
    if let values = value as? [String: Any] {
        return values.mapValues(jsonValue)
    }
    if let values = value as? NSDictionary {
        var result: [String: Any] = [:]
        for (key, item) in values {
            result[String(describing: key)] = jsonValue(item)
        }
        return result
    }
    return String(describing: value)
}

private final class WebPage: NSObject, WKNavigationDelegate {
    let window: NSWindow
    let webView: WKWebView
    private var loadCompletion: ((Result<Void, Error>) -> Void)?

    init(width: Int, height: Int, show: Bool, transparent: Bool, title: String) {
        let rect = NSRect(x: 0, y: 0, width: max(1, width), height: max(1, height))
        let configuration = WKWebViewConfiguration()
        configuration.preferences.isElementFullscreenEnabled = false
        if !show {
            // WKWebView intentionally suspends requestAnimationFrame for an ordered-out
            // window. the renderers seek animations explicitly and use rAF only as a
            // paint barrier, so a zero-delay timer is the deterministic native equivalent.
            configuration.userContentController.addUserScript(WKUserScript(
                source: "window.requestAnimationFrame = function (callback) { return setTimeout(function () { callback(performance.now()); }, 0); }; window.cancelAnimationFrame = clearTimeout;",
                injectionTime: .atDocumentStart,
                forMainFrameOnly: false
            ))
        }
        webView = WKWebView(frame: rect, configuration: configuration)
        window = NSWindow(
            contentRect: rect,
            styleMask: show ? [.titled, .closable, .resizable] : [.borderless],
            backing: .buffered,
            defer: false
        )
        super.init()
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        if #available(macOS 12.0, *) {
            webView.underPageBackgroundColor = transparent ? .clear : .black
        }
        window.backgroundColor = transparent ? .clear : .black
        window.isOpaque = !transparent
        window.title = title
        window.contentView = webView
        window.isReleasedWhenClosed = false
        if show {
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
        } else {
            window.orderOut(nil)
        }
    }

    func load(url: URL, allowingReadAccessTo root: URL? = nil, completion: @escaping (Result<Void, Error>) -> Void) {
        loadCompletion = completion
        if url.isFileURL, let root {
            webView.loadFileURL(url, allowingReadAccessTo: root)
        } else {
            webView.load(URLRequest(url: url))
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loadCompletion?(.success(()))
        loadCompletion = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadCompletion?(.failure(error))
        loadCompletion = nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadCompletion?(.failure(error))
        loadCompletion = nil
    }

    func evaluate(_ source: String, completion: @escaping (Result<Any, Error>) -> Void) {
        // WKWebView's traditional evaluateJavaScript API rejects Promise values,
        // while callAsyncJavaScript can await them. Execute the trusted bridge
        // source directly as an expression instead of feeding it through eval():
        // page CSP correctly blocks eval(), which previously made every native
        // motion render fail with the opaque "A JavaScript exception occurred".
        let wrapper = """
        const value = await (
        \(source)
        );
        return value === undefined ? null : value;
        """
        webView.callAsyncJavaScript(
            wrapper,
            arguments: [:],
            in: nil,
            in: .page,
            completionHandler: { result in
            switch result {
            case .success(let value): completion(.success(jsonValue(value)))
            case .failure(let error): completion(.failure(error))
            }
        })
    }

    func capture(completion: @escaping (Result<[String: Any], Error>) -> Void) {
        let configuration = WKSnapshotConfiguration()
        configuration.rect = webView.bounds
        configuration.snapshotWidth = NSNumber(value: max(1, Int(webView.bounds.width)))
        webView.takeSnapshot(with: configuration) { image, error in
            if let error {
                completion(.failure(error))
                return
            }
            guard let image,
                  let tiff = image.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: tiff),
                  let png = bitmap.representation(using: .png, properties: [:]) else {
                completion(.failure(NSError(
                    domain: "jev.web-renderer",
                    code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "WebKit did not return a PNG snapshot"]
                )))
                return
            }
            completion(.success([
                "png": png.base64EncodedString(),
                "width": bitmap.pixelsWide,
                "height": bitmap.pixelsHigh,
            ]))
        }
    }

    func setSize(width: Int, height: Int) {
        let size = NSSize(width: max(1, width), height: max(1, height))
        window.setContentSize(size)
        webView.frame = NSRect(origin: .zero, size: size)
    }

    func show() {
        NSApp.activate(ignoringOtherApps: true)
        window.makeKeyAndOrderFront(nil)
    }

    func close() {
        webView.stopLoading()
        window.orderOut(nil)
        window.close()
    }
}

private final class RendererHost {
    private var pages: [Int: WebPage] = [:]

    func handle(_ command: [String: Any]) {
        guard let id = command["id"] as? Int,
              let operation = command["op"] as? String else { return }
        let windowID = command["windowId"] as? Int
        let args = command["args"] as? [String: Any] ?? [:]

        switch operation {
        case "create":
            guard let windowID else { reject(id, "create requires a window id"); return }
            let width = args["width"] as? Int ?? 800
            let height = args["height"] as? Int ?? 600
            let show = args["show"] as? Bool ?? false
            let transparent = args["transparent"] as? Bool ?? false
            let title = args["title"] as? String ?? "jev renderer"
            pages[windowID]?.close()
            pages[windowID] = WebPage(width: width, height: height, show: show, transparent: transparent, title: title)
            reply(id)

        case "loadURL":
            guard let page = page(windowID, replyID: id),
                  let value = args["url"] as? String,
                  let url = URL(string: value) else { return }
            page.load(url: url) { result in
                switch result { case .success: reply(id); case .failure(let error): reject(id, error) }
            }

        case "loadFile":
            guard let page = page(windowID, replyID: id),
                  let value = args["path"] as? String else { return }
            let url = URL(fileURLWithPath: value)
            let root = URL(fileURLWithPath: value).deletingLastPathComponent()
            page.load(url: url, allowingReadAccessTo: root) { result in
                switch result { case .success: reply(id); case .failure(let error): reject(id, error) }
            }

        case "evaluate":
            guard let page = page(windowID, replyID: id),
                  let source = args["source"] as? String else { return }
            page.evaluate(source) { result in
                switch result { case .success(let value): reply(id, value: value); case .failure(let error): reject(id, error) }
            }

        case "capture":
            guard let page = page(windowID, replyID: id) else { return }
            page.capture { result in
                switch result { case .success(let value): reply(id, value: value); case .failure(let error): reject(id, error) }
            }

        case "setSize":
            guard let page = page(windowID, replyID: id) else { return }
            page.setSize(width: args["width"] as? Int ?? 800, height: args["height"] as? Int ?? 600)
            reply(id)

        case "show":
            guard let page = page(windowID, replyID: id) else { return }
            page.show()
            reply(id)

        case "setBackgroundColor":
            guard let page = page(windowID, replyID: id) else { return }
            let color = args["color"] as? String ?? "transparent"
            page.evaluate("(document.documentElement.style.background = \(String(reflecting: color)), true)") { _ in reply(id) }

        case "matteVideo":
            startNativeMatteVideo(args: args) { result in
                DispatchQueue.main.async {
                    switch result {
                    case .success(let value): reply(id, value: value)
                    case .failure(let error): reject(id, error)
                    }
                }
            }

        case "destroy":
            guard let windowID else { reject(id, "destroy requires a window id"); return }
            pages.removeValue(forKey: windowID)?.close()
            reply(id)

        default:
            reject(id, "Unknown web renderer operation: \(operation)")
        }
    }

    private func page(_ id: Int?, replyID: Int) -> WebPage? {
        guard let id, let page = pages[id] else {
            reject(replyID, "Web renderer window is not available")
            return nil
        }
        return page
    }
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)
private let host = RendererHost()

DispatchQueue.global(qos: .userInitiated).async {
    while let line = readLine() {
        guard let data = line.data(using: .utf8),
              let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { continue }
        DispatchQueue.main.async { host.handle(command) }
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
}

application.run()
