// CLI: matte <in-dir> <out-dir> [accurate|balanced|fast]
// Runs Apple Vision's person segmentation (VNGeneratePersonSegmentationRequest) on every
// .png/.jpg in <in-dir> (sorted by name, treated as ONE video sequence so the request can
// use temporal state) and writes an 8-bit grayscale PNG matte of the same size and name into
// <out-dir> (white = person). Prints JSON on stdout:
//   {"frames":[{"file":"00000.png","coverage":0.31}],"ms":1234,"quality":"accurate"}
// coverage = mean matte value (0..1), so the caller can tell "no person found".
import Foundation
import Vision
import CoreImage
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

struct FrameStat: Codable { let file: String; let coverage: Double }
struct Report: Codable { let frames: [FrameStat]; let ms: Int; let quality: String }

func fail(_ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(1)
}

let args = CommandLine.arguments
guard args.count >= 3 else { fail("usage: matte <in-dir> <out-dir> [accurate|balanced|fast]") }
let inDir = args[1]
let outDir = args[2]
let qualityName = args.count > 3 ? args[3] : "accurate"
let quality: VNGeneratePersonSegmentationRequest.QualityLevel =
    qualityName == "fast" ? .fast : (qualityName == "balanced" ? .balanced : .accurate)

let fm = FileManager.default
try? fm.createDirectory(atPath: outDir, withIntermediateDirectories: true)
guard let entries = try? fm.contentsOfDirectory(atPath: inDir) else { fail("cannot read directory: \(inDir)") }
let files = entries.filter { let l = $0.lowercased(); return l.hasSuffix(".png") || l.hasSuffix(".jpg") }.sorted()
if files.isEmpty { fail("no frames in \(inDir)") }

let ciContext = CIContext(options: [.useSoftwareRenderer: false])
let gray = CGColorSpaceCreateDeviceGray()
let handler = VNSequenceRequestHandler()
let started = Date()
var stats: [FrameStat] = []

for file in files {
    let url = URL(fileURLWithPath: (inDir as NSString).appendingPathComponent(file))
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fail("cannot decode \(file)") }
    let request = VNGeneratePersonSegmentationRequest()
    request.qualityLevel = quality
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8
    do { try handler.perform([request], on: cg) } catch { fail("vision failed on \(file): \(error)") }
    guard let obs = request.results?.first as? VNPixelBufferObservation else { fail("no mask for \(file)") }

    // scale the (low-res) mask up to the frame size
    var mask = CIImage(cvPixelBuffer: obs.pixelBuffer)
    let sx = CGFloat(cg.width) / mask.extent.width
    let sy = CGFloat(cg.height) / mask.extent.height
    mask = mask.transformed(by: CGAffineTransform(scaleX: sx, y: sy), highQualityDownsample: true)
        .cropped(to: CGRect(x: 0, y: 0, width: cg.width, height: cg.height))
    guard let outCG = ciContext.createCGImage(mask, from: mask.extent, format: .L8, colorSpace: gray) else {
        fail("cannot render matte for \(file)")
    }

    // coverage: mean of a 64x112 box-downsample (cheap)
    var sum = 0.0
    let sw = 64, sh = 112
    if let small = CGContext(data: nil, width: sw, height: sh, bitsPerComponent: 8, bytesPerRow: sw,
                             space: gray, bitmapInfo: CGImageAlphaInfo.none.rawValue) {
        small.interpolationQuality = .medium
        small.draw(outCG, in: CGRect(x: 0, y: 0, width: sw, height: sh))
        if let d = small.data {
            let p = d.bindMemory(to: UInt8.self, capacity: sw * sh)
            for i in 0..<(sw * sh) { sum += Double(p[i]) }
        }
    }
    stats.append(FrameStat(file: file, coverage: sum / Double(sw * sh) / 255.0))

    let outURL = URL(fileURLWithPath: (outDir as NSString).appendingPathComponent((file as NSString).deletingPathExtension + ".png"))
    guard let dest = CGImageDestinationCreateWithURL(outURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
        fail("cannot write \(outURL.path)")
    }
    CGImageDestinationAddImage(dest, outCG, nil)
    if !CGImageDestinationFinalize(dest) { fail("cannot finalize \(outURL.path)") }
}

let report = Report(frames: stats, ms: Int(Date().timeIntervalSince(started) * 1000), quality: qualityName)
let data = try! JSONEncoder().encode(report)
print(String(data: data, encoding: .utf8)!)
