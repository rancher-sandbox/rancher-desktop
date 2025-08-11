<#
.SYNOPSIS
  Set the display resolution on the current monitor to a pre-set size.
.DESCRIPTION
  Set the current display to at least the desired size, for use with CI where
  the display is smaller than expected.
#>

Param(
  # The minimum width to set; return an error if this is not supported.
  [UInt32]$MinimumWidth = 1440,
  # The minimum height to set; return an error if this is not supported.
  [UInt32]$MinimumHeight = 900,
  # The minimum bits per pixel to set; return an error if this is not supported.
  [UInt32]$MinimumBitsPerPixel = 32,
  # If set, actually change the resolution.
  [PSDefaultValue(Help='True, if running in CI; otherwise false')]
  [switch]$ChangeResolution = !!$ENV:CI
)

$cSharpSource = @'

using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential, Pack = 1, CharSet = CharSet.Auto)]
internal struct DEVMODE {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
  public string dmDeviceName;
  public UInt16 dmSpecVersion;
  public UInt16 dmDriverVersion;
  public UInt16 dmSize;
  public UInt16 dmDriverExtra;
  public UInt32 dmFields;

  public Int32 dmPositionX;
  public Int32 dmPositionY;
  public UInt32 dmDisplayOrientation;
  public UInt32 dmDisplayFixedOutput;

  public short dmColor;
  public short dmDuplex;
  public short dmVerticalResolution;
  public short dmTTOption;
  public short dmCollate;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
  public string dmFormName;
  public UInt16 dmLogPixels;
  public UInt32 dmBitsPerPixel;
  public UInt32 dmPixelsWidth;
  public UInt32 dmPixelsHeight;
  public UInt32 dmDisplayFlags;
  public UInt32 dmDisplayFrequency;
}

internal class User32 {
  public const UInt32 ENUM_CURRENT_SETTINGS = unchecked((uint)-1);
  [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  public static extern Int32 EnumDisplaySettings(
    String deviceName,
    UInt32 modeNum,
    ref DEVMODE devMode);

  public const Int32 DISP_CHANGE_SUCCESSFUL = 0;
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern Int32 ChangeDisplaySettings(
    ref DEVMODE devMode,
    UInt32 flags);
}

public class DisplayResolution {
  static public void SetResolution(bool changeResolution, UInt32 MinWidth, UInt32 MinHeight, UInt32 MinBitsPerPixel) {
    DEVMODE dm = new DEVMODE(), bestMode = new DEVMODE();
    ulong bestSize = 0;
    dm.dmDeviceName = new String(new char[32]);
    dm.dmFormName = new String(new char[32]);
    dm.dmSize = (UInt16)Marshal.SizeOf(dm);

    var rv = User32.EnumDisplaySettings(null, User32.ENUM_CURRENT_SETTINGS, ref dm);
    if (rv == 0) {
      int error = Marshal.GetLastWin32Error();
      throw new InvalidOperationException(
        String.Format("Failed to get current display settings: {0:x}", error));
    }

    Console.WriteLine(String.Format(
      "Current display is {0}x{1} ({2})",
      dm.dmPixelsWidth, dm.dmPixelsHeight, dm.dmBitsPerPixel));

    for (UInt32 i = 0; ; i++) {
      rv = User32.EnumDisplaySettings(null, i, ref dm);
      if (rv == 0) {
        break;
      }
      Console.WriteLine(String.Format(
        "#{0,3} {1,6}x{2,-6} ({3})", i, dm.dmPixelsWidth, dm.dmPixelsHeight, dm.dmBitsPerPixel));
      if (dm.dmPixelsWidth >= MinWidth && dm.dmPixelsHeight >= MinHeight && dm.dmBitsPerPixel >= MinBitsPerPixel) {
        if (dm.dmPixelsWidth * dm.dmPixelsHeight > bestSize) {
          bestSize = dm.dmPixelsWidth * dm.dmPixelsHeight;
          bestMode = dm;
        }
      }
    }

    if (bestSize < 1) {
      throw new NotSupportedException("Desired resolution is not found");
    }
    Console.WriteLine(String.Format(
      "Picking resolution: {0}x{1} ({2})",
      bestMode.dmPixelsWidth, bestMode.dmPixelsHeight, bestMode.dmBitsPerPixel));
    if (changeResolution) {
      rv = User32.ChangeDisplaySettings(ref bestMode, 0);
      if (rv != User32.DISP_CHANGE_SUCCESSFUL) {
        throw new InvalidOperationException(
          String.Format("Failed to change resolution: {0}", rv));
      }
    }

    rv = User32.EnumDisplaySettings(null, User32.ENUM_CURRENT_SETTINGS, ref dm);
    if (rv == 0) {
      int error = Marshal.GetLastWin32Error();
      throw new InvalidOperationException(
        String.Format("Failed to get modified display settings: {0:x}", error));
    }

    Console.WriteLine(String.Format(
      "Modified display is {0}x{1}",
      dm.dmPixelsWidth, dm.dmPixelsHeight));
  }
}

'@

Add-Type $cSharpSource
[DisplayResolution]::SetResolution($ChangeResolution, $MinimumWidth, $MinimumHeight, $MinimumBitsPerPixel)
