/**
 * Patch iOS native deps after npm install:
 * - react-native-image-picker: kUTType* → UTType* (iOS 15 deprecation warnings)
 * - react-native-webview: fix dataDetectorTypes mask conversion warnings (New Arch)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const log = (msg) => console.log(`[patch-ios-native-deps] ${msg}`);

const imagePickerPatches = [
  {
    file: 'node_modules/react-native-image-picker/ios/ImagePickerManager.mm',
    replacements: [
      ['#import <MobileCoreServices/MobileCoreServices.h>', '#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>'],
      ['CGImageDestinationCreateWithData(imageData, kUTTypeJPEG, 1, NULL)', 'CGImageDestinationCreateWithData(imageData, (__bridge CFStringRef)UTTypeJPEG.identifier, 1, NULL)'],
      ['[info[UIImagePickerControllerMediaType] isEqualToString:(NSString *) kUTTypeImage]', '[info[UIImagePickerControllerMediaType] isEqualToString:UTTypeImage.identifier]'],
      // Repair a previously broken patch that dropped the closing ']'.
      ['[info[UIImagePickerControllerMediaType] isEqualToString:UTTypeImage.identifier)', '[info[UIImagePickerControllerMediaType] isEqualToString:UTTypeImage.identifier]'],
      ['[provider hasItemConformingToTypeIdentifier:(NSString *)kUTTypeImage]', '[provider hasItemConformingToTypeIdentifier:UTTypeImage.identifier'],
      ['[provider hasItemConformingToTypeIdentifier:(NSString *)kUTTypeMovie]', '[provider hasItemConformingToTypeIdentifier:UTTypeMovie.identifier'],
      ['loadFileRepresentationForTypeIdentifier:(NSString *)kUTTypeMovie', 'loadFileRepresentationForTypeIdentifier:UTTypeMovie.identifier'],
    ],
  },
  {
    file: 'node_modules/react-native-image-picker/ios/ImagePickerUtils.mm',
    replacements: [
      ['#import <CoreServices/CoreServices.h>', '#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>'],
      ['picker.mediaTypes = @[(NSString *)kUTTypeMovie];', 'picker.mediaTypes = @[UTTypeMovie.identifier];'],
      ['picker.mediaTypes = @[(NSString *)kUTTypeImage];', 'picker.mediaTypes = @[UTTypeImage.identifier];'],
      ['picker.mediaTypes = @[(NSString *)kUTTypeImage, (NSString *)kUTTypeMovie];', 'picker.mediaTypes = @[UTTypeImage.identifier, UTTypeMovie.identifier];'],
      [
        `+ (NSString *) getFileTypeFromUrl:(NSURL *)url {
    CFStringRef fileExtension = (__bridge CFStringRef)[url pathExtension];
    CFStringRef UTI = UTTypeCreatePreferredIdentifierForTag(kUTTagClassFilenameExtension, fileExtension, NULL);
    CFStringRef MIMEType = UTTypeCopyPreferredTagWithClass(UTI, kUTTagClassMIMEType);
    CFRelease(UTI);
    return (__bridge_transfer NSString *)MIMEType;
}`,
        `+ (NSString *) getFileTypeFromUrl:(NSURL *)url {
    NSString *ext = [url pathExtension];
    if (ext.length == 0) {
        return nil;
    }
    UTType *type = [UTType typeWithFilenameExtension:ext];
    return type.preferredMIMEType;
}`,
      ],
    ],
  },
];

const webViewBrokenBlock = `#if !TARGET_OS_OSX
    if (oldViewProps.dataDetectorTypes != newViewProps.dataDetectorTypes) {
        WKDataDetectorTypes dataDetectorTypes = WKDataDetectorTypeNone;
            if (dataDetectorTypes & RNCWebViewDataDetectorTypes::Address) {
                dataDetectorTypes |= WKDataDetectorTypeAddress;
            } else if (dataDetectorTypes & RNCWebViewDataDetectorTypes::Link) {
                dataDetectorTypes |= WKDataDetectorTypeLink;
            } else if (dataDetectorTypes & RNCWebViewDataDetectorTypes::CalendarEvent) {
                dataDetectorTypes |= WKDataDetectorTypeCalendarEvent;
            } else if (dataDetectorTypes & RNCWebViewDataDetectorTypes::TrackingNumber) {
                dataDetectorTypes |= WKDataDetectorTypeTrackingNumber;
            } else if (dataDetectorTypes & RNCWebViewDataDetectorTypes::FlightNumber) {
                dataDetectorTypes |= WKDataDetectorTypeFlightNumber;
            } else if (dataDetectorTypes & RNCWebViewDataDetectorTypes::LookupSuggestion) {
                dataDetectorTypes |= WKDataDetectorTypeLookupSuggestion;
            } else if (dataDetectorTypes & RNCWebViewDataDetectorTypes::PhoneNumber) {
                dataDetectorTypes |= WKDataDetectorTypePhoneNumber;
            } else if (dataDetectorTypes & RNCWebViewDataDetectorTypes::All) {
                dataDetectorTypes |= WKDataDetectorTypeAll;
            } else if (dataDetectorTypes & RNCWebViewDataDetectorTypes::None) {
                dataDetectorTypes = WKDataDetectorTypeNone;
        }
        [_view setDataDetectorTypes:dataDetectorTypes];
    }
#endif // !TARGET_OS_OSX`;

const webViewFixedBlock = `#if !TARGET_OS_OSX
    if (oldViewProps.dataDetectorTypes != newViewProps.dataDetectorTypes) {
        const RNCWebViewDataDetectorTypesMask mask = newViewProps.dataDetectorTypes;
        WKDataDetectorTypes dataDetectorTypes = WKDataDetectorTypeNone;

        if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::All)) != 0) {
            dataDetectorTypes = WKDataDetectorTypeAll;
        } else if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::None)) != 0) {
            dataDetectorTypes = WKDataDetectorTypeNone;
        } else {
            if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::Address)) != 0) {
                dataDetectorTypes |= WKDataDetectorTypeAddress;
            }
            if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::Link)) != 0) {
                dataDetectorTypes |= WKDataDetectorTypeLink;
            }
            if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::CalendarEvent)) != 0) {
                dataDetectorTypes |= WKDataDetectorTypeCalendarEvent;
            }
            if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::TrackingNumber)) != 0) {
                dataDetectorTypes |= WKDataDetectorTypeTrackingNumber;
            }
            if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::FlightNumber)) != 0) {
                dataDetectorTypes |= WKDataDetectorTypeFlightNumber;
            }
            if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::LookupSuggestion)) != 0) {
                dataDetectorTypes |= WKDataDetectorTypeLookupSuggestion;
            }
            if ((mask & static_cast<RNCWebViewDataDetectorTypesMask>(RNCWebViewDataDetectorTypes::PhoneNumber)) != 0) {
                dataDetectorTypes |= WKDataDetectorTypePhoneNumber;
            }
        }
        [_view setDataDetectorTypes:dataDetectorTypes];
    }
#endif // !TARGET_OS_OSX`;

let changed = 0;

for (const { file, replacements } of imagePickerPatches) {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) continue;

  let src = fs.readFileSync(abs, 'utf8');
  const needsImagePickerPatch =
    src.includes('kUTType') ||
    src.includes('kUTTagClass') ||
    src.includes('isEqualToString:UTTypeImage.identifier)');
  if (!needsImagePickerPatch) continue;

  for (const [from, to] of replacements) {
    src = src.split(from).join(to);
  }

  fs.writeFileSync(abs, src, 'utf8');
  changed += 1;
  log(`patched ${file}`);
}

const webViewFile = path.join(root, 'node_modules/react-native-webview/apple/RNCWebView.mm');
if (fs.existsSync(webViewFile)) {
  let webViewSrc = fs.readFileSync(webViewFile, 'utf8');
  if (webViewSrc.includes(webViewBrokenBlock)) {
    webViewSrc = webViewSrc.replace(webViewBrokenBlock, webViewFixedBlock);
    fs.writeFileSync(webViewFile, webViewSrc, 'utf8');
    changed += 1;
    log('patched node_modules/react-native-webview/apple/RNCWebView.mm');
  } else if (!webViewSrc.includes('const RNCWebViewDataDetectorTypesMask mask = newViewProps.dataDetectorTypes')) {
    log('react-native-webview RNCWebView.mm layout changed — manual patch may be needed');
  }
}

if (changed === 0) {
  log('nothing to patch (already up to date or packages missing)');
}
