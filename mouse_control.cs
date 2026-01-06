using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

// Compile with: csc mouse_control.cs
public class MouseControl {
    [DllImport("user32.dll")]
    static extern bool SetCursorPos(int X, int Y);
    [DllImport("user32.dll")]
    static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
    [DllImport("user32.dll")]
    static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    const int MOUSEEVENTF_LEFTDOWN = 0x02;
    const int MOUSEEVENTF_LEFTUP = 0x04;
    const int MOUSEEVENTF_RIGHTDOWN = 0x08;
    const int MOUSEEVENTF_RIGHTUP = 0x10;

    public static void Main(string[] args) {
        if (args.Length == 0) return;

        string command = args[0];

        try {
            if (command == "move" && args.Length >= 3) {
                int x = int.Parse(args[1]);
                int y = int.Parse(args[2]);
                SetCursorPos(x, y);
            }
            else if (command == "click" && args.Length >= 3) {
                int x = int.Parse(args[1]);
                int y = int.Parse(args[2]);
                SetCursorPos(x, y); // Move first
                mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
                mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
            }
            else if (command == "dblclick" && args.Length >= 3) {
                 int x = int.Parse(args[1]);
                 int y = int.Parse(args[2]);
                 SetCursorPos(x, y);
                 mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
                 mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
                 System.Threading.Thread.Sleep(50);
                 mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
                 mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
            }
        } catch (Exception e) {
            Console.WriteLine("Error: " + e.Message);
        }
    }
}
