<#
.SYNOPSIS
  Take a screenshot of the active window.
.DESCRIPTION
  Take a screenshot of the active window and output it to a PNG file.
.PARAMETER FilePath
  The name of the file to write to.  The file will be a PNG.
#>
Param(
  [Parameter(
    Mandatory = $true
  )][string]$FilePath
)

# We need to call Win32 APIs; PowerShell natively understands .NET only, so we
# need to write some C#...
$cSharpSource = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

namespace Screenshot {
  public class Screenshot {
    public void Take(string filePath) {
      Image img = CaptureActiveWindow();
      img.Save(filePath, System.Drawing.Imaging.ImageFormat.Png);
    }

    public Image CaptureActiveWindow() {
      return CaptureWindow(User32.GetForegroundWindow());
    }

    public Image CaptureWindow(IntPtr hwnd) {
      // Rancher Desktop (Electron/Chromium) uses accelerated (OpenGL/DirectX)
      // rendering, so using BitBlt and related functions based on DCs will just
      // emit a fully black image.  Instead, we need to take a screenshot of the
      // whole screen, cropped to the area we need.

      // Determine the bounds of the source window, excluding shadows.
      // GetWindowRect() now includes shadows, so that's not useful.
      DWMAPI.RECT rect = new DWMAPI.RECT();
      Int32 hr = DWMAPI.DwmGetWindowAttribute(
        hwnd,
        DWMAPI.DWMWA_EXTENDED_FRAME_BOUNDS,
        out rect,
        Marshal.SizeOf(typeof(DWMAPI.RECT)));
      if (hr != 0) {
        throw new InvalidOperationException(
          String.Format("Failed to get window size: {0:x}", hr));
      }

      // Create a new bitmap with the desired size.
      Size size = new Size(rect.right - rect.left, rect.bottom - rect.top);
      Bitmap bitmap = new Bitmap(size.Width, size.Height);

      // Get a "graphics" object that can help copy the image.
      Graphics graphics = Graphics.FromImage(bitmap);

      // Do the actual copying.
      graphics.CopyFromScreen(rect.left, rect.top, 0, 0, size);

      return bitmap;
    }

    private class User32 {
      [DllImport("user32.dll")]
      public static extern IntPtr GetForegroundWindow();
    }

    private class DWMAPI {
      [StructLayout(LayoutKind.Sequential)]
      public struct RECT
      {
          public int left;
          public int top;
          public int right;
          public int bottom;
      }

      public const Int32 DWMWA_EXTENDED_FRAME_BOUNDS = 9;

      [DllImport("dwmapi.dll")]
      public static extern Int32 DwmGetWindowAttribute(
        IntPtr hwnd,
        Int32 attribute,
        out RECT pvAttribute,
        int cbAttribute);
    }
  }
}
'@

Add-Type $cSharpSource -ReferencedAssemblies 'System.Drawing'

(New-Object Screenshot.Screenshot).Take($FilePath)
