using System;
using System.Runtime.InteropServices;
using System.Threading;

namespace NativeListen
{
    class Program
    {
        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        static void Main(string[] args)
        {
            if (args.Length == 0)
            {
                // Default loop or exit? Let's just exit or wait.
                // We need a key to listen to.
                return;
            }

            if (!int.TryParse(args[0], out int targetKey))
            {
                return;
            }

            bool wasPressed = false;

            while (true)
            {
                // High bit set = key is down
                bool isPressed = (GetAsyncKeyState(targetKey) & 0x8000) != 0;

                if (isPressed && !wasPressed)
                {
                    Console.WriteLine("D"); // Down
                    wasPressed = true;
                }
                else if (!isPressed && wasPressed)
                {
                    Console.WriteLine("U"); // Up
                    wasPressed = false;
                }

                Thread.Sleep(5); // Low CPU usage, fast response (5ms polling)
            }
        }
    }
}
