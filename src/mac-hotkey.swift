import Foundation
import CoreGraphics

if CommandLine.arguments.count < 6 {
  fputs("Usage: mac-hotkey <keyCode> <cmd:0|1> <alt:0|1> <shift:0|1> <ctrl:0|1>\n", stderr)
  exit(64)
}

let rawKeyCode = Int(CommandLine.arguments[1]) ?? 0
let modifierOnly = rawKeyCode < 0
let keyCode = CGKeyCode(UInt16(max(rawKeyCode, 0)))
let needCmd = CommandLine.arguments[2] == "1"
let needAlt = CommandLine.arguments[3] == "1"
let needShift = CommandLine.arguments[4] == "1"
let needCtrl = CommandLine.arguments[5] == "1"
var isHeld = false

func modifiersMatch(_ flags: CGEventFlags) -> Bool {
  // CGEventFlags can include unrelated system flags (Caps Lock, Fn,
  // non-coalesced event markers, etc.). Only compare the four modifiers that
  // are part of a Wisper shortcut. The old exact check could let the hotkey
  // pass through to the focused app and cause the macOS alert/beep sound.
  let relevant = flags.intersection([.maskCommand, .maskAlternate, .maskShift, .maskControl])
  let hasCmd = relevant.contains(.maskCommand)
  let hasAlt = relevant.contains(.maskAlternate)
  let hasShift = relevant.contains(.maskShift)
  let hasCtrl = relevant.contains(.maskControl)
  return hasCmd == needCmd && hasAlt == needAlt && hasShift == needShift && hasCtrl == needCtrl
}

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    return Unmanaged.passUnretained(event)
  }

  if modifierOnly && type == .flagsChanged {
    let matches = modifiersMatch(event.flags)
    if matches && !isHeld {
      isHeld = true
      print("HOTKEY_DOWN")
      fflush(stdout)
      return nil
    }
    if !matches && isHeld {
      isHeld = false
      print("HOTKEY_UP")
      fflush(stdout)
      return nil
    }
    return Unmanaged.passUnretained(event)
  }

  guard !modifierOnly && (type == .keyDown || type == .keyUp) else {
    return Unmanaged.passUnretained(event)
  }

  let code = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
  guard code == keyCode else {
    return Unmanaged.passUnretained(event)
  }

  if type == .keyDown && !isHeld && modifiersMatch(event.flags) {
    isHeld = true
    print("HOTKEY_DOWN")
    fflush(stdout)
    return nil
  }

  if type == .keyUp && isHeld {
    isHeld = false
    print("HOTKEY_UP")
    fflush(stdout)
    return nil
  }

  return Unmanaged.passUnretained(event)
}

let mask = modifierOnly
  ? (1 << CGEventType.flagsChanged.rawValue)
  : ((1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue))

guard let tap = CGEvent.tapCreate(
  tap: .cgSessionEventTap,
  place: .headInsertEventTap,
  options: .defaultTap,
  eventsOfInterest: CGEventMask(mask),
  callback: callback,
  userInfo: nil
) else {
  fputs("REGISTER_FAILED:Accessibility permission required\n", stderr)
  exit(2)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
print("REGISTERED")
fflush(stdout)
CFRunLoopRun()
