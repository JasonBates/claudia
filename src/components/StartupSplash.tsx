import claudiaLogo from "../assets/claudia-logo.jpg";

interface StartupSplashProps {
  workingDir: string | null;
}

export default function StartupSplash(props: StartupSplashProps) {
  // Truncate long paths to just show last 2-3 segments
  const displayPath = () => {
    const dir = props.workingDir;
    if (!dir) return "...";

    const parts = dir.split("/").filter(Boolean);
    if (parts.length <= 3) return dir;

    // Show ~/ prefix if home dir, otherwise last 2 segments
    if (dir.startsWith("/Users/")) {
      const afterUsers = parts.slice(2); // Skip "Users" and username
      if (afterUsers.length <= 2) return "~/" + afterUsers.join("/");
      return "~/.../" + afterUsers.slice(-2).join("/");
    }

    return ".../" + parts.slice(-2).join("/");
  };

  return (
    <div class="startup-splash">
      <div class="startup-content">
        <img src={claudiaLogo} alt="Claudia" class="startup-logo" />
        <pre class="startup-ascii">{`█▀▀ █   ▄▀█ █ █ █▀▄ █ ▄▀█
█▄▄ █▄▄ █▀█ █▄█ █▄▀ █ █▀█`}</pre>
      </div>
    </div>
  );
}
