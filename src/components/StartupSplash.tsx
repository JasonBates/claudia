import claudiaLogo from "../assets/claudia-logo.jpg";

interface StartupSplashProps {
  workingDir: string | null;
}

export default function StartupSplash(_props: StartupSplashProps) {
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
