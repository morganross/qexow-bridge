using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace BridgeTray
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new TrayApplicationContext());
        }
    }

    public class TrayApplicationContext : ApplicationContext
    {
        private NotifyIcon trayIcon;
        private const string ProcessName = "codex-antigravity-bridge";

        public TrayApplicationContext()
        {
            ContextMenuStrip contextMenu = new ContextMenuStrip();
            contextMenu.Items.Add("Status", null, Status_Click);
            contextMenu.Items.Add("Start Broker", null, Start_Click);
            contextMenu.Items.Add("Stop Broker", null, Stop_Click);
            contextMenu.Items.Add(new ToolStripSeparator());
            contextMenu.Items.Add("Exit", null, Exit_Click);

            trayIcon = new NotifyIcon()
            {
                Icon = SystemIcons.Information,
                ContextMenuStrip = contextMenu,
                Visible = true,
                Text = "Codex Antigravity Broker"
            };

            trayIcon.DoubleClick += Status_Click;
        }

        private void Status_Click(object sender, EventArgs e)
        {
            var processes = Process.GetProcessesByName(ProcessName);
            bool isDaemonRunning = processes.Any();
            string daemonDetail = isDaemonRunning 
                ? string.Format("running (PID {0})", string.Join(", ", processes.Select(p => p.Id))) 
                : "stopped — right-click tray and select 'Start Broker'";

            System.Text.StringBuilder sb = new System.Text.StringBuilder();
            sb.AppendLine("[ANTIGRAVITY BRIDGE]");
            sb.AppendLine(string.Format("{0} Bridge Tray App: running (PID {1})", "OK ", Process.GetCurrentProcess().Id));
            sb.AppendLine(string.Format("{0} Bridge Daemon ({1}): {2}", isDaemonRunning ? "OK " : "BAD ", ProcessName, daemonDetail));
            sb.AppendLine();
            sb.AppendLine("[SYSTEM DIAGNOSTICS]");
            sb.Append(RunCamDoctor());

            Form statusForm = new Form();
            statusForm.Text = "Antigravity Broker Status";
            statusForm.Size = new System.Drawing.Size(760, 560);
            statusForm.MinimumSize = new System.Drawing.Size(500, 300);
            statusForm.StartPosition = FormStartPosition.CenterScreen;
            statusForm.BackColor = System.Drawing.Color.FromArgb(15, 15, 25);
            statusForm.ForeColor = System.Drawing.Color.White;

            RichTextBox rtb = new RichTextBox();
            rtb.Dock = DockStyle.Fill;
            rtb.ReadOnly = true;
            rtb.Font = new System.Drawing.Font("Consolas", 10f);
            rtb.BackColor = System.Drawing.Color.FromArgb(15, 15, 25);
            rtb.ForeColor = System.Drawing.Color.White;
            rtb.BorderStyle = BorderStyle.None;
            rtb.ScrollBars = RichTextBoxScrollBars.Vertical;

            string[] outputLines = sb.ToString().Replace("\r\n", "\n").Replace("\r", "\n").Split('\n');
            foreach (string outputLine in outputLines)
            {
                int start = rtb.TextLength;
                rtb.AppendText(outputLine + "\n");
                rtb.Select(start, outputLine.Length);
                if (outputLine.StartsWith("OK "))
                    rtb.SelectionColor = System.Drawing.Color.LimeGreen;
                else if (outputLine.StartsWith("BAD"))
                    rtb.SelectionColor = System.Drawing.Color.OrangeRed;
                else if (outputLine.StartsWith("[") && outputLine.EndsWith("]"))
                    rtb.SelectionColor = System.Drawing.Color.CornflowerBlue;
                else
                    rtb.SelectionColor = System.Drawing.Color.Silver;
            }
            rtb.SelectionStart = 0;
            rtb.SelectionLength = 0;

            statusForm.Controls.Add(rtb);
            statusForm.ShowDialog();
        }

        private string RunCamDoctor()
        {
            try
            {
                string camPath = "cam.exe"; // Try path first
                string progFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
                string candidate = Path.Combine(progFiles, "Codex Agent Manager", "cam.exe");
                if (File.Exists(candidate))
                {
                    camPath = candidate;
                }
                else
                {
                    string progFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
                    candidate = Path.Combine(progFilesX86, "Codex Agent Manager", "cam.exe");
                    if (File.Exists(candidate))
                    {
                        camPath = candidate;
                    }
                }

                ProcessStartInfo processInfo = new ProcessStartInfo(camPath, "doctor")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                using (Process process = Process.Start(processInfo))
                {
                    if (process.WaitForExit(8000))
                    {
                        string output = process.StandardOutput.ReadToEnd();
                        string error = process.StandardError.ReadToEnd();
                        if (!string.IsNullOrWhiteSpace(error))
                        {
                            return output + "\n" + error;
                        }
                        return output;
                    }
                    else
                    {
                        process.Kill();
                        return "BAD: cam doctor timed out after 8 seconds.";
                    }
                }
            }
            catch (Exception ex)
            {
                return "BAD Codex Agent Manager: cam.exe not found or failed to execute (" + ex.Message + "). Please install Codex Agent Manager.";
            }
        }

        private void Start_Click(object sender, EventArgs e)
        {
            if (Process.GetProcessesByName(ProcessName).Any())
            {
                MessageBox.Show("Broker is already running.", "Start Broker", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            try
            {
                string exeDir = AppDomain.CurrentDomain.BaseDirectory;
                string brokerExe = Path.Combine(exeDir, ProcessName + ".exe");

                if (!File.Exists(brokerExe))
                {
                    MessageBox.Show(string.Format("Executable not found: {0}", brokerExe), "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                ProcessStartInfo processInfo = new ProcessStartInfo(brokerExe)
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden
                };

                Process.Start(processInfo);
                MessageBox.Show("Broker started successfully.", "Start Broker", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(string.Format("Failed to start broker: {0}", ex.Message), "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void Stop_Click(object sender, EventArgs e)
        {
            var processes = Process.GetProcessesByName(ProcessName);
            if (!processes.Any())
            {
                MessageBox.Show("Broker is not running.", "Stop Broker", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }

            try
            {
                foreach (var process in processes)
                {
                    process.Kill();
                }
                MessageBox.Show("Broker stopped successfully.", "Stop Broker", MessageBoxButtons.OK, MessageBoxIcon.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(string.Format("Failed to stop broker: {0}", ex.Message), "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void Exit_Click(object sender, EventArgs e)
        {
            trayIcon.Visible = false;
            Application.Exit();
        }
    }
}
