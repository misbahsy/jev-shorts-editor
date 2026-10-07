// CLI: faces <directory-of-jpgs>
// Runs VNDetectFaceRectanglesRequest on every .jpg in the directory and
// prints JSON: [{file, faces:[{x,y,w,h}]}] with TOP-LEFT-origin normalized
// boxes (Vision reports bottom-left origin — flipped here).
import Foundation
import Vision
import CoreGraphics
import ImageIO

struct FaceBox: Codable { let x: Double; let y: Double; let w: Double; let h: Double }
struct FrameResult: Codable { let file: String; let faces: [FaceBox] }

func detectFaces(imagePath: String) -> [FaceBox] {
    guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: imagePath) as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        return []
    }
    let request = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return []
    }
    guard let results = request.results else { return [] }
    // Vision boundingBox is normalized, ORIGIN BOTTOM-LEFT. Flip y to top-left.
    return results.map { obs in
        let bb = obs.boundingBox
        return FaceBox(x: bb.origin.x, y: 1.0 - bb.origin.y - bb.height, w: bb.width, h: bb.height)
    }
}

let args = CommandLine.arguments
guard args.count > 1 else {
    FileHandle.standardError.write("usage: faces <directory-of-jpgs>\n".data(using: .utf8)!)
    exit(1)
}
let dir = args[1]
let fm = FileManager.default
guard let entries = try? fm.contentsOfDirectory(atPath: dir) else {
    FileHandle.standardError.write("cannot read directory: \(dir)\n".data(using: .utf8)!)
    exit(1)
}
let jpgs = entries.filter { $0.lowercased().hasSuffix(".jpg") || $0.lowercased().hasSuffix(".jpeg") }.sorted()

var results: [FrameResult] = []
for file in jpgs {
    let path = (dir as NSString).appendingPathComponent(file)
    let faces = detectFaces(imagePath: path)
    results.append(FrameResult(file: file, faces: faces))
}

let encoder = JSONEncoder()
if let data = try? encoder.encode(results), let str = String(data: data, encoding: .utf8) {
    print(str)
} else {
    print("[]")
}
