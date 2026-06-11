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
            bool isRunning = Process.GetProcessesByName(ProcessName).Any();
            string status = isRunning ? "RUNNING" : "STOPPED";
            string message = string.Format("Antigravity Broker Daemon is currently {0}.", status);
            MessageBoxIcon icon = isRunning ? MessageBoxIcon.Information : MessageBoxIcon.Warning;
            
            MessageBox.Show(message, "Broker Status", MessageBoxButtons.OK, icon);
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
