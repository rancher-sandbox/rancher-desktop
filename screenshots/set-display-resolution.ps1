<#
.SYNOPSIS
  Set the display resolution on the current monitor to a pre-set size.
.DESCRIPTION
  Set the current display to at least 1440x900x32, for use with CI where the
  display is smaller than expected.
#>

Param(
  [switch]$ChangeResolution = !!$ENV:CI
)

$cSharpSource = @'

using System;
using System.Runtime.InteropServices;

namespace DisplayResolution {
  [StructLayout(LayoutKind.Sequential, Pack = 1, CharSet = CharSet.Auto)]
  internal struct DEVMODE {
    public const int CCHDEVICENAME = 32; // multimon.h
    public const int CCHFORMNAME = 32; // wingdi.h

    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCHDEVICENAME)]
    public string dmDeviceName;
    public UInt16 dmSpecVersion;
    public UInt16 dmDriverVersion;
    public UInt16 dmSize;
    public UInt16 dmDriverExtra;
    public UInt32 dmFields;

    // using the DUMMYSTRUCTNAME2 variant because it has the right size
    public Int32 dmPositionX;
    public Int32 dmPositionY;
    public UInt32 dmDisplayOrientation;
    public UInt32 dmDisplayFixedOutput;

    public short dmColor;
    public short dmDuplex;
    public short dmYResolution;
    public short dmTTOption;
    public short dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCHFORMNAME)]
    public string dmFormName;
    public UInt16 dmLogPixels;
    public UInt32 dmBitsPerPel;
    public UInt32 dmPelsWidth;
    public UInt32 dmPelsHeight;
    public UInt32 dmDisplayFlags;
    public UInt32 dmDisplayFrequency;
  }

  internal class User32 {
    public const UInt32 ENUM_CURRENT_SETTINGS = unchecked((uint)-1);
    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern Int32 EnumDisplaySettings(
      String lpszDeviceName,
      UInt32 iModeNum,
      ref DEVMODE lpDevMode);

    public const Int32 DISP_CHANGE_SUCCESSFUL = 0; // winuser.h
    public const Int32 DISP_CHANGE_RESTART = 1; // winuser.h
    public const Int32 DISP_CHANGE_FAILED = -1; // winuser.h
    public const Int32 DISP_CHANGE_BADMODE = -2; // winuser.h
    public const Int32 DISP_CHANGE_NOTUPDATED = -3; // winuser.h
    public const Int32 DISP_CHANGE_BADFLAGS = -4; // winuser.h
    public const Int32 DISP_CHANGE_BADPARAM = -5; // winuser.h
    public const Int32 DISP_CHANGE_BADDUALVIEW = -6; // winuser.h
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern Int32 ChangeDisplaySettings(
      ref DEVMODE lpDevMode,
      UInt32 dwFlags);
  }

  public class DisplayResolution {
    static public void SetResolution(bool changeResolution) {
      DEVMODE dm = new DEVMODE(), bestMode = new DEVMODE();
      ulong bestSize = 0;
      dm.dmDeviceName = new String(new char[DEVMODE.CCHDEVICENAME]);
      dm.dmFormName = new String(new char[DEVMODE.CCHFORMNAME]);
      dm.dmSize = (UInt16)Marshal.SizeOf(dm);

      var rv = User32.EnumDisplaySettings(null, User32.ENUM_CURRENT_SETTINGS, ref dm);
      if (rv == 0) {
        int error = Marshal.GetLastWin32Error();
        throw new InvalidOperationException(
          String.Format("Failed to get current display settings: {0:x}", error));
      }

      Console.WriteLine(String.Format(
        "Current display is {0}x{1}",
        dm.dmPelsWidth, dm.dmPelsHeight));

      for (UInt32 i = 0; ; i++) {
        rv = User32.EnumDisplaySettings(null, i, ref dm);
        if (rv == 0) {
          break;
        }
        Console.WriteLine(String.Format(
          "#{0,3} {1,6}x{2,-6} ({3})", i, dm.dmPelsWidth, dm.dmPelsHeight, dm.dmBitsPerPel));
        if (dm.dmPelsWidth >= 1440 && dm.dmPelsHeight >= 900 && dm.dmBitsPerPel >= 32) {
          if (dm.dmPelsWidth * dm.dmPelsHeight > bestSize) {
            bestSize = dm.dmPelsWidth * dm.dmPelsHeight;
            bestMode = dm;
          }
        }
      }

      if (bestSize < 1) {
        throw new NotSupportedException("Desired resolution is not found");
      }
      Console.WriteLine(String.Format(
        "Picking resolution: {0}x{1} ({2})",
        bestMode.dmPelsWidth, bestMode.dmPelsHeight, bestMode.dmBitsPerPel));
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
        dm.dmPelsWidth, dm.dmPelsHeight));
    }
  }
}

'@

Add-Type $cSharpSource
[DisplayResolution.DisplayResolution]::SetResolution($ChangeResolution)
