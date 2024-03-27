<#
.SYNOPSIS
  Take a screenshot of the active window.
.DESCRIPTION
  Take a screenshot of the active window and output it to a PNG file.
.PARAMETER FilePath
  The name of the file to write to.  The file will be a PNG.
.PARAMETER Title
  The title of the window to capture; if not give, defaults to the active window.
#>
Param(
  [Parameter(
    Mandatory = $true
  )][string]$FilePath,
  [string]$Title
)

# We need to call Win32 APIs; PowerShell natively understands .NET only, so we
# need to write some C#...
$cSharpSource = @'
using System;
using System.Drawing;
using System.Runtime.InteropServices;

namespace Screenshot {
  public class Screenshot {
    public void Take(string filePath, string title) {
      Image img;
      if (title != "") {
        img = CaptureWindowWithTitle(title);
      } else {
        img = CaptureActiveWindow();
      }
      img.Save(filePath, System.Drawing.Imaging.ImageFormat.Png);
    }

    public Image CaptureActiveWindow() {
      return CaptureWindow(User32.GetForegroundWindow());
    }

    public Image CaptureWindowWithTitle(string title) {
      IntPtr hwnd = User32.FindWindow(null, title);
      if (User32.SetForegroundWindow(hwnd) != 0) {
        return CaptureWindow(hwnd);
      }
      // Failed to set the window as foreground; make it topmost instead.
      Int32 styles = User32.GetWindowLong(hwnd, User32.GWL_EXSTYLE);
      User32.SetWindowPos(hwnd, (IntPtr)(User32.HWND_TOPMOST), 0, 0, 0, 0,
        User32.SWP_NOSIZE | User32.SWP_NOMOVE);
      Image image = CaptureWindow(hwnd);
      if ((styles & User32.WS_EX_TOPMOST) == 0) {
        User32.SetWindowPos(hwnd, (IntPtr)(User32.HWND_NOTOPMOST), 0, 0, 0, 0,
          User32.SWP_NOSIZE | User32.SWP_NOMOVE);
      }
      return image;
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
      public const Int32 GWL_EXSTYLE = -20;
      public const Int32 HWND_TOPMOST = -1;
      public const Int32 HWND_NOTOPMOST = -2;
      public const UInt32 SWP_NOSIZE = 0x0001;
      public const UInt32 SWP_NOMOVE = 0x0002;
      public const Int32 WS_EX_TOPMOST = 0x00000008;

      [DllImport("user32.dll", CharSet = CharSet.Unicode)]
      public static extern IntPtr FindWindow(
        String windowClass,
        String windowTitle);
      [DllImport("user32.dll")]
      public static extern IntPtr GetForegroundWindow();
      [DllImport("user32.dll")]
      public static extern Int32 GetWindowLong(IntPtr hwnd, Int32 index);
      [DllImport("user32.dll")]
      public static extern Int32 SetForegroundWindow(IntPtr hwnd);
      [DllImport("user32.dll")]
      public static extern Int32 SetWindowPos(
        IntPtr hwnd,
        IntPtr hwndInsertAfter,
        Int32 x, Int32 y,
        Int32 cx, Int32 cy,
        UInt32 flags);
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

(New-Object Screenshot.Screenshot).Take($FilePath, $Title)
