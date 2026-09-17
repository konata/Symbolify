// Generates the extension icon extension/assets/symbolify.png:
// IntelliJ method-purple (#B389C5) rounded square + white text.magnifyingglass.
// Usage: swift tools/icon.swift
import AppKit

let size: CGFloat = 256
let canvas = NSImage(size: NSSize(width: size, height: size))
canvas.lockFocus()

let tile = NSRect(x: 10, y: 10, width: size - 20, height: size - 20)
NSColor(srgbRed: 0.702, green: 0.537, blue: 0.773, alpha: 1).setFill()
NSBezierPath(roundedRect: tile, xRadius: 52, yRadius: 52).fill()

// render the SF Symbol in white: draw the template, then fill white with sourceAtop
let configured = NSImage(systemSymbolName: "text.magnifyingglass", accessibilityDescription: nil)!
  .withSymbolConfiguration(.init(pointSize: 120, weight: .medium))!
let white = NSImage(size: configured.size)
white.lockFocus()
configured.draw(in: NSRect(origin: .zero, size: configured.size))
NSColor.white.setFill()
NSRect(origin: .zero, size: configured.size).fill(using: .sourceAtop)
white.unlockFocus()

// aspect-fit and center inside the tile (~70%)
let fit = min(tile.width * 0.7 / white.size.width, tile.height * 0.7 / white.size.height)
let drawn = NSRect(
  x: tile.midX - white.size.width * fit / 2, y: tile.midY - white.size.height * fit / 2,
  width: white.size.width * fit, height: white.size.height * fit
)
white.draw(in: drawn)
canvas.unlockFocus()

let dir = URL(fileURLWithPath: "extension/assets")
try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
let png = NSBitmapImageRep(data: canvas.tiffRepresentation!)!.representation(using: .png, properties: [:])!
try! png.write(to: dir.appendingPathComponent("symbolify.png"))
print("wrote extension/assets/symbolify.png (\(png.count) bytes)")
