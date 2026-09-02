using System;
using System.Diagnostics;
using System.IO;
using System.Threading.Tasks;

internal static class VidgistNativeHostLauncher
{
    public static int Main()
    {
        string directory = AppDomain.CurrentDomain.BaseDirectory;
        string script = Path.Combine(directory, "vidgist_native_host.py");
        string python = FindOnPath("python.exe");
        if (String.IsNullOrWhiteSpace(python) || !File.Exists(script)) return 1;
        var start = new ProcessStartInfo(python, "\"" + script + "\"") {
            UseShellExecute = false, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true
        };
        using (var process = Process.Start(start)) {
            if (process == null) return 1;
            Task input = Task.Factory.StartNew(() => Console.OpenStandardInput().CopyTo(process.StandardInput.BaseStream));
            Task output = Task.Factory.StartNew(() => process.StandardOutput.BaseStream.CopyTo(Console.OpenStandardOutput()));
            Task errors = Task.Factory.StartNew(() => process.StandardError.ReadToEnd());
            process.WaitForExit();
            try { Task.WaitAll(input, output, errors); } catch (AggregateException) { }
            return process.ExitCode;
        }
    }

    private static string FindOnPath(string fileName)
    {
        foreach (string directory in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';')) {
            string candidate = Path.Combine(directory.Trim().Trim('\"'), fileName);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
