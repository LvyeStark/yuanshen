#!/usr/bin/env swift

import AVFoundation
import CoreMedia
import Foundation
import ImageIO
import UniformTypeIdentifiers

enum PairError: Error, CustomStringConvertible {
    case message(String)

    var description: String {
        switch self {
        case .message(let text): return text
        }
    }
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

func writePairedPhoto(
    coverURL: URL,
    sourceMetadataURL: URL?,
    outputURL: URL,
    assetIdentifier: String
) throws {
    guard let coverSource = CGImageSourceCreateWithURL(coverURL as CFURL, nil) else {
        throw PairError.message("无法读取 Live Photo 封面。")
    }

    let coverProperties = (CGImageSourceCopyPropertiesAtIndex(coverSource, 0, nil) as? [String: Any]) ?? [:]
    var properties = coverProperties
    if let metadataURL = sourceMetadataURL,
       let metadataSource = CGImageSourceCreateWithURL(metadataURL as CFURL, nil),
       let sourceProperties = CGImageSourceCopyPropertiesAtIndex(metadataSource, 0, nil) as? [String: Any] {
        properties = sourceProperties
        for structuralKey in [
            kCGImagePropertyPixelWidth,
            kCGImagePropertyPixelHeight,
            kCGImagePropertyOrientation,
            kCGImagePropertyColorModel,
            kCGImagePropertyDepth,
            kCGImagePropertyHasAlpha,
            kCGImagePropertyProfileName,
        ] {
            let key = structuralKey as String
            if let coverValue = coverProperties[key] {
                properties[key] = coverValue
            }
        }
    }

    var makerApple = (properties[kCGImagePropertyMakerAppleDictionary as String] as? [String: Any]) ?? [:]
    makerApple["17"] = assetIdentifier
    properties[kCGImagePropertyMakerAppleDictionary as String] = makerApple
    properties[kCGImagePropertyOrientation as String] = 1
    properties[kCGImagePropertyPixelWidth as String] = coverProperties[kCGImagePropertyPixelWidth as String]
    properties[kCGImagePropertyPixelHeight as String] = coverProperties[kCGImagePropertyPixelHeight as String]

    guard let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL,
        UTType.jpeg.identifier as CFString,
        1,
        nil
    ) else {
        throw PairError.message("无法创建 Live Photo 封面文件。")
    }
    CGImageDestinationAddImageFromSource(destination, coverSource, 0, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
        throw PairError.message("Live Photo 封面元数据写入失败。")
    }
}

func makeStillImageMetadataFormat() throws -> CMMetadataFormatDescription {
    let specification: [String: Any] = [
        kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier as String:
            "mdta/com.apple.quicktime.still-image-time",
        kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType as String:
            kCMMetadataBaseDataType_SInt8 as String,
    ]
    var formatDescription: CMMetadataFormatDescription?
    let status = CMMetadataFormatDescriptionCreateWithMetadataSpecifications(
        allocator: kCFAllocatorDefault,
        metadataType: kCMMetadataFormatType_Boxed,
        metadataSpecifications: [specification] as CFArray,
        formatDescriptionOut: &formatDescription
    )
    guard status == noErr, let formatDescription else {
        throw PairError.message("无法创建 Live Photo 静态帧元数据轨道（\(status)）。")
    }
    return formatDescription
}

func writePairedVideo(
    inputURL: URL,
    outputURL: URL,
    assetIdentifier: String,
    stillImageTimeSeconds: Double
) throws {
    let asset = AVURLAsset(url: inputURL)
    guard let sourceTrack = asset.tracks(withMediaType: .video).first,
          let rawFormatHint = sourceTrack.formatDescriptions.first else {
        throw PairError.message("输入视频没有可用的视频轨道。")
    }
    let formatHint = rawFormatHint as! CMFormatDescription

    let reader = try AVAssetReader(asset: asset)
    let readerOutput = AVAssetReaderTrackOutput(track: sourceTrack, outputSettings: nil)
    readerOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(readerOutput) else {
        throw PairError.message("无法读取输入视频轨道。")
    }
    reader.add(readerOutput)

    try? FileManager.default.removeItem(at: outputURL)
    let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mov)
    let videoInput = AVAssetWriterInput(
        mediaType: .video,
        outputSettings: nil,
        sourceFormatHint: formatHint
    )
    videoInput.transform = sourceTrack.preferredTransform
    guard writer.canAdd(videoInput) else {
        throw PairError.message("无法写入 Live Photo 视频轨道。")
    }
    writer.add(videoInput)

    let metadataFormat = try makeStillImageMetadataFormat()
    let metadataInput = AVAssetWriterInput(
        mediaType: .metadata,
        outputSettings: nil,
        sourceFormatHint: metadataFormat
    )
    guard writer.canAdd(metadataInput) else {
        throw PairError.message("无法写入 Live Photo 静态帧时间轨道。")
    }
    writer.add(metadataInput)
    let metadataAdaptor = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metadataInput)

    let identifierItem = AVMutableMetadataItem()
    identifierItem.keySpace = .quickTimeMetadata
    identifierItem.key = "com.apple.quicktime.content.identifier" as NSString
    identifierItem.value = assetIdentifier as NSString
    identifierItem.dataType = kCMMetadataBaseDataType_UTF8 as String
    writer.metadata = asset.metadata + [identifierItem]

    guard writer.startWriting(), reader.startReading() else {
        throw PairError.message(writer.error?.localizedDescription ?? reader.error?.localizedDescription ?? "Live Photo 视频初始化失败。")
    }
    writer.startSession(atSourceTime: .zero)

    let stillItem = AVMutableMetadataItem()
    stillItem.keySpace = .quickTimeMetadata
    stillItem.key = "com.apple.quicktime.still-image-time" as NSString
    stillItem.value = NSNumber(value: Int8(0))
    stillItem.dataType = kCMMetadataBaseDataType_SInt8 as String
    let stillTime = CMTime(seconds: max(0, stillImageTimeSeconds), preferredTimescale: 600)
    let timedGroup = AVTimedMetadataGroup(
        items: [stillItem],
        timeRange: CMTimeRange(start: stillTime, duration: CMTime(value: 1, timescale: 30))
    )
    guard metadataAdaptor.append(timedGroup) else {
        throw PairError.message("Live Photo 静态帧时间写入失败。")
    }
    metadataInput.markAsFinished()

    while reader.status == .reading {
        if videoInput.isReadyForMoreMediaData {
            guard let sampleBuffer = readerOutput.copyNextSampleBuffer() else { break }
            if !videoInput.append(sampleBuffer) {
                throw PairError.message(writer.error?.localizedDescription ?? "Live Photo 视频帧写入失败。")
            }
        } else {
            Thread.sleep(forTimeInterval: 0.002)
        }
    }
    videoInput.markAsFinished()
    if reader.status == .failed {
        throw PairError.message(reader.error?.localizedDescription ?? "Live Photo 视频读取失败。")
    }

    let finishSemaphore = DispatchSemaphore(value: 0)
    writer.finishWriting { finishSemaphore.signal() }
    finishSemaphore.wait()
    guard writer.status == .completed else {
        throw PairError.message(writer.error?.localizedDescription ?? "Live Photo MOV 封装失败。")
    }
}

func validatePair(photoURL: URL, videoURL: URL, assetIdentifier: String) throws {
    guard let photoSource = CGImageSourceCreateWithURL(photoURL as CFURL, nil),
          let photoProperties = CGImageSourceCopyPropertiesAtIndex(photoSource, 0, nil) as? [String: Any],
          let makerApple = photoProperties[kCGImagePropertyMakerAppleDictionary as String] as? [String: Any],
          String(describing: makerApple["17"] ?? "") == assetIdentifier else {
        throw PairError.message("Live Photo 封面缺少配对标识。")
    }
    let videoAsset = AVURLAsset(url: videoURL)
    let metadataItems: [AVMetadataItem] = videoAsset.metadata
    let hasIdentifier = metadataItems.contains(where: { item -> Bool in
        let key = item.identifier?.rawValue ?? String(describing: item.key)
        return key.contains("content.identifier") && item.stringValue == assetIdentifier
    })
    guard hasIdentifier else {
        throw PairError.message("Live Photo MOV 缺少配对标识。")
    }
    guard !videoAsset.tracks(withMediaType: .metadata).isEmpty else {
        throw PairError.message("Live Photo MOV 缺少静态帧时间轨道。")
    }
}

guard CommandLine.arguments.count == 7 else {
    fail("用法：live-photo-pair.swift <input.mp4> <cover.jpg> <source-or-dash> <output.mov> <output.jpg> <asset-id>")
}

let inputVideoURL = URL(fileURLWithPath: CommandLine.arguments[1])
let inputCoverURL = URL(fileURLWithPath: CommandLine.arguments[2])
let sourceArgument = CommandLine.arguments[3]
let sourceMetadataURL = sourceArgument == "-" ? nil : URL(fileURLWithPath: sourceArgument)
let outputVideoURL = URL(fileURLWithPath: CommandLine.arguments[4])
let outputPhotoURL = URL(fileURLWithPath: CommandLine.arguments[5])
let assetIdentifier = CommandLine.arguments[6]

do {
    try writePairedPhoto(
        coverURL: inputCoverURL,
        sourceMetadataURL: sourceMetadataURL,
        outputURL: outputPhotoURL,
        assetIdentifier: assetIdentifier
    )
    let asset = AVURLAsset(url: inputVideoURL)
    let duration = CMTimeGetSeconds(asset.duration)
    let stillTime = max(0, duration - (1.0 / 30.0))
    try writePairedVideo(
        inputURL: inputVideoURL,
        outputURL: outputVideoURL,
        assetIdentifier: assetIdentifier,
        stillImageTimeSeconds: stillTime
    )
    try validatePair(photoURL: outputPhotoURL, videoURL: outputVideoURL, assetIdentifier: assetIdentifier)
    print(assetIdentifier)
} catch {
    try? FileManager.default.removeItem(at: outputVideoURL)
    try? FileManager.default.removeItem(at: outputPhotoURL)
    fail(String(describing: error))
}
