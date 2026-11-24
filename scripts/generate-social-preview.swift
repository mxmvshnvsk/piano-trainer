// Run on macOS from the repository root:
// swift -module-cache-path /tmp/piano-swift-cache scripts/generate-social-preview.swift
// CoreText reads the same local WOFF2 fonts as the app. The SVG outlines its
// text so neither GitHub nor a later image renderer needs installed fonts.
import Foundation
import CoreGraphics
import CoreText
import ImageIO
import UniformTypeIdentifiers

let width = 1280, height = 640
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8,
                        bytesPerRow: width * 4, space: space,
                        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.translateBy(x: 0, y: CGFloat(height)); context.scaleBy(x: 1, y: -1)
context.setAllowsAntialiasing(true)
var svg = ["<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"1280\" height=\"640\" viewBox=\"0 0 1280 640\" role=\"img\" aria-labelledby=\"title description\">", "<title id=\"title\">Piano practice</title>", "<desc id=\"description\">Chords, scales and rhythm. An offline piano trainer with microphone recognition. A minor is illustrated with A4, C5 and E5.</desc>", "<defs><radialGradient id=\"glow\"><stop stop-color=\"#3a2f45\" stop-opacity=\"0.9\"/><stop offset=\"1\" stop-color=\"#201e25\" stop-opacity=\"0\"/></radialGradient><linearGradient id=\"shimmer\" x1=\"0\" y1=\"1\" x2=\"1\" y2=\"0\"><stop stop-color=\"#a592b8\"/><stop offset=\"0.48\" stop-color=\"#dbcbea\"/><stop offset=\"1\" stop-color=\"#bba8cc\"/></linearGradient></defs>"]
func number(_ value: CGFloat) -> String { String(format: "%0.3f", Double(value)) }
func color(_ hex: String, _ alpha: CGFloat = 1) -> CGColor {
    let value = UInt32(hex.dropFirst(), radix: 16)!
    return CGColor(colorSpace: space, components: [CGFloat((value >> 16) & 255)/255, CGFloat((value >> 8) & 255)/255, CGFloat(value & 255)/255, alpha])!
}
func data(_ path: CGPath) -> String {
    var parts: [String] = []
    path.applyWithBlock { element in
        let e = element.pointee, p = e.points
        switch e.type {
        case .moveToPoint: parts.append("M\(number(p[0].x)) \(number(p[0].y))")
        case .addLineToPoint: parts.append("L\(number(p[0].x)) \(number(p[0].y))")
        case .addQuadCurveToPoint: parts.append("Q\(number(p[0].x)) \(number(p[0].y)) \(number(p[1].x)) \(number(p[1].y))")
        case .addCurveToPoint: parts.append("C\(number(p[0].x)) \(number(p[0].y)) \(number(p[1].x)) \(number(p[1].y)) \(number(p[2].x)) \(number(p[2].y))")
        case .closeSubpath: parts.append("Z")
        @unknown default: break
        }
    }
    return parts.joined()
}
func fill(_ path: CGPath, _ hex: String, stroke: String? = nil, line: CGFloat = 1) {
    context.addPath(path); context.setFillColor(color(hex)); context.fillPath()
    if let stroke = stroke { context.addPath(path); context.setStrokeColor(color(stroke)); context.setLineWidth(line); context.strokePath() }
    svg.append("<path d=\"\(data(path))\" fill=\"\(hex)\"\(stroke.map { " stroke=\"\($0)\" stroke-width=\"\(line)\"" } ?? "")/>")
}
func rounded(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ radius: CGFloat, _ hex: String, stroke: String? = nil) {
    fill(CGPath(roundedRect: CGRect(x:x,y:y,width:w,height:h), cornerWidth:radius, cornerHeight:radius, transform:nil), hex, stroke:stroke)
}
func shimmer(_ path: CGPath) {
    context.saveGState(); context.addPath(path); context.clip()
    let bounds = path.boundingBoxOfPath
    let gradient = CGGradient(colorsSpace:space, colors:[color("#a592b8"),color("#dbcbea"),color("#bba8cc")] as CFArray, locations:[0,0.48,1])!
    context.drawLinearGradient(gradient, start:CGPoint(x:bounds.minX,y:bounds.maxY), end:CGPoint(x:bounds.maxX,y:bounds.minY), options:[.drawsBeforeStartLocation,.drawsAfterEndLocation]); context.restoreGState()
    svg.append("<path d=\"\(data(path))\" fill=\"url(#shimmer)\"/>")
}
func font(_ file: String, _ size: CGFloat) -> CTFont {
    let url = URL(fileURLWithPath:FileManager.default.currentDirectoryPath).appendingPathComponent(file)
    let descriptors = CTFontManagerCreateFontDescriptorsFromURL(url as CFURL) as! [CTFontDescriptor]
    return CTFontCreateWithFontDescriptor(descriptors[0], size, nil)
}
let serifFile = "node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff2"
let italicFile = "node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-italic.woff2"
let sansFile = "node_modules/@fontsource/manrope/files/manrope-latin-400-normal.woff2"
func textPath(_ string: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ file: String, centered: Bool = false, tracking: CGFloat = 0) -> CGPath {
    let attributes: [NSAttributedString.Key:Any] = [NSAttributedString.Key(kCTFontAttributeName as String):font(file,size), NSAttributedString.Key(kCTKernAttributeName as String):tracking]
    let line = CTLineCreateWithAttributedString(NSAttributedString(string:string, attributes:attributes))
    let offset = centered ? CGFloat(CTLineGetTypographicBounds(line,nil,nil,nil))/2 : 0
    let result = CGMutablePath()
    for run in CTLineGetGlyphRuns(line) as! [CTRun] {
        let count = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating:0,count:count), positions = [CGPoint](repeating:.zero,count:count)
        CTRunGetGlyphs(run,CFRange(location:0,length:0),&glyphs); CTRunGetPositions(run,CFRange(location:0,length:0),&positions)
        let attrs = CTRunGetAttributes(run) as NSDictionary
        let face = attrs[kCTFontAttributeName] as! CTFont
        for i in 0..<count {
            if let path = CTFontCreatePathForGlyph(face,glyphs[i],nil) {
                let transform = CGAffineTransform(a:1,b:0,c:0,d:-1,tx:x+positions[i].x-offset,ty:y-positions[i].y)
                result.addPath(path,transform:transform)
            }
        }
    }
    return result
}
func text(_ string:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat,_ file:String,_ hex:String,centered:Bool=false,tracking:CGFloat=0) {
    fill(textPath(string,x,y,size,file,centered:centered,tracking:tracking),hex)
}
func svgPath(_ source:String) -> CGPath {
    let regex = try! NSRegularExpression(pattern:"[A-Za-z]|-?[0-9]+(?:\\.[0-9]+)?")
    let tokens = regex.matches(in:source,range:NSRange(source.startIndex...,in:source)).map { String(source[Range($0.range,in:source)!]) }
    var i=0, command="M"; let path=CGMutablePath()
    func point()->CGPoint { let p=CGPoint(x:Double(tokens[i])!,y:Double(tokens[i+1])!);i+=2;return p }
    while i<tokens.count {
        if tokens[i].first!.isLetter {command=tokens[i];i+=1}
        switch command {
        case "M":path.move(to:point());command="L"
        case "L":path.addLine(to:point())
        case "C":let p1=point(),p2=point(),p3=point();path.addCurve(to:p3,control1:p1,control2:p2)
        case "Z":path.closeSubpath();command=""
        default:fatalError("Unsupported SVG command: \(command)")
        }
    }
    return path
}

rounded(0,0,1280,640,0,"#201e25")
context.saveGState()
let glow = CGGradient(colorsSpace:space,colors:[color("#3a2f45",0.9),color("#201e25",0)] as CFArray,locations:[0,1])!
context.drawRadialGradient(glow,startCenter:CGPoint(x:960,y:310),startRadius:0,endCenter:CGPoint(x:960,y:310),endRadius:460,options:[])
context.restoreGState()
svg.append("<ellipse cx=\"960\" cy=\"310\" rx=\"460\" ry=\"460\" fill=\"url(#glow)\"/>")
let border = CGPath(roundedRect:CGRect(x:24,y:24,width:1232,height:592),cornerWidth:28,cornerHeight:28,transform:nil)
context.addPath(border);context.setStrokeColor(color("#393240"));context.setLineWidth(1);context.strokePath()
svg.append("<path d=\"\(data(border))\" fill=\"none\" stroke=\"#393240\"/>")

text("A LITTLE PRACTICE, EVERY DAY",82,108,12,sansFile,"#afa5b8",tracking:1.8)
text("piano",76,248,112,italicFile,"#e0d9e6")
text("practice",76,343,112,italicFile,"#e0d9e6")
text("Chords, scales & rhythm.",83,405,25,sansFile,"#d3cadb")
text("Microphone  ·  Offline  ·  Open source",84,454,14,sansFile,"#afa5b8")
text("mxmvshnvsk / piano-trainer",84,560,13,sansFile,"#8f859a")

let chord = CGMutablePath()
chord.addPath(textPath("A",815,304,182,serifFile))
chord.addPath(textPath("m",934,304,126,serifFile))
shimmer(chord)
let palmSource = try String(contentsOfFile:"public/palm.svg",encoding:.utf8)
let match = try NSRegularExpression(pattern:" d=\"([^\"]+)\"").firstMatch(in:palmSource,range:NSRange(palmSource.startIndex...,in:palmSource))!
let palm = svgPath(String(palmSource[Range(match.range(at:1),in:palmSource)!]))
var palmTransform = CGAffineTransform(a:0.68,b:0,c:0,d:0.68,tx:1072,ty:183)
shimmer(palm.copy(using:&palmTransform)!)
text("A minor",957,348,16,sansFile,"#c7bdd1",centered:true)
rounded(883,365,148,33,16.5,"#342c40")
text("1st octave · A4",957,386,12,sansFile,"#b9aec5",centered:true)

let kx:CGFloat=702, ky:CGFloat=443, kw:CGFloat=34, kh:CGFloat=101
rounded(kx-3,ky-3,kw*14+6,kh+6,11,"#51465c")
let notes=[60,62,64,65,67,69,71,72,74,76,77,79,81,83]
for (index,note) in notes.enumerated() {
    let active=[69,72,76].contains(note)
    rounded(kx+CGFloat(index)*kw,ky,kw-2,kh,5,active ? "#bba8cc" : "#ddd6e2")
    if active || note==60 {
        let label = [60:"C4",69:"A4",72:"C5",76:"E5"][note]!
        text(label,kx+CGFloat(index)*kw+(kw-2)/2,ky+kh-12,9,sansFile,active ? "#362744" : "#766981",centered:true)
    }
}
for index in 0..<14 where [0,1,3,4,5].contains(index%7) {
    rounded(kx+CGFloat(index+1)*kw-10,ky-1,18,62,3,"#3a3246")
}
text("A4   ·   C5   ·   E5",940,575,12,sansFile,"#afa5b8",centered:true,tracking:0.4)
svg.append("</svg>")
try svg.joined(separator:"\n").write(toFile:"public/social-preview.svg",atomically:true,encoding:.utf8)
let output=URL(fileURLWithPath:FileManager.default.currentDirectoryPath).appendingPathComponent("public/social-preview.png")
let destination=CGImageDestinationCreateWithURL(output as CFURL,UTType.png.identifier as CFString,1,nil)!
CGImageDestinationAddImage(destination,context.makeImage()!,nil)
precondition(CGImageDestinationFinalize(destination))
print("Created public/social-preview.png (1280×640) and outlined SVG source")
