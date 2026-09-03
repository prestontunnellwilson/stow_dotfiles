# After editing this file, run `just apply` on the host.
{ lib
, modulesPath
, pkgs
, unstablePkgs
, ...
}:
{
  imports = [
    (modulesPath + "/profiles/qemu-guest.nix")
  ];

  networking.hostName = "nix-dev";

  # lima-init creates the login user from Lima's boot-time metadata.
  users.mutableUsers = true;

  # Enable lima-init, lima-guestagent, other config needed for Lima support (via `nixos-lima.nixosModules.lima`)
  services.lima.enable = true;

  nix.settings.experimental-features = [
    "nix-command"
    "flakes"
  ];

  # ssh
  services.openssh = {
    enable = true;
    settings = {
      KbdInteractiveAuthentication = false;
      PasswordAuthentication = false;
      PermitRootLogin = "no";
    };
  };

  security.sudo.wheelNeedsPassword = false;

  programs.fish.enable = true;
  programs.starship.enable = true;
  programs.git.enable = true;

  # Language toolchains come from mise reading a project's .tool-versions, not
  # from nixpkgs, so the VM tracks whatever versions that project pins. mise
  # installs upstream release tarballs, which are dynamically linked against a
  # normal FHS glibc, so nix-ld is what makes them runnable here. It is also what
  # lets an editor's or coding agent's remote-ssh server run its bundled node.
  programs.nix-ld = {
    enable = true;
    libraries = with pkgs; [
      stdenv.cc.cc.lib
      zlib
      openssl
      curl
      icu
      libuuid
    ];
  };

  environment.etc."mise/config.toml".text = ''
    [settings]
    # Single-user development VM: every mise config under /home is ours.
    trusted_config_paths = ["/home"]
    [settings.node]
    # nix-ld makes upstream's prebuilt node runnable here, so take the tarball.
    # Left to itself mise decides this host cannot run the prebuilt binary and
    # spends the better part of an hour compiling node from source instead.
    compile = false
  '';

  # limactl shell forwards TERM with its pseudo-terminal, but not COLORTERM.
  # Declare the VM's true-color support so Helix uses its full default theme.
  environment.sessionVariables = {
    COLORTERM = "truecolor";
    EDITOR = "hx";
    VISUAL = "hx";

    # mise's shims work in non-interactive shells too, which `just` recipes,
    # `limactl shell -- <cmd>` and remote-ssh tooling rely on. ~/.local/bin is
    # where `corepack enable --install-directory` puts its shims, for projects
    # that pin a package manager through package.json rather than through mise.
    PATH = [ "$HOME/.local/share/mise/shims" "$HOME/.local/bin" ];

    COREPACK_ENABLE_DOWNLOAD_PROMPT = "0";
  };

  # The Lima user already exists before this configuration is installed. Read
  # its name from Lima's metadata so this configuration works for any host user.
  systemd.services.lima-init.postStart = ''
    lima_user="$(${pkgs.gnused}/bin/sed -n 's/^LIMA_CIDATA_USER=//p' /mnt/lima-cidata/lima.env)"
    ${pkgs.shadow}/bin/usermod --shell /run/current-system/sw/bin/fish "$lima_user"
  '';

  boot = {
    kernelPackages = pkgs.linuxPackages_latest;
    loader.grub = {
      device = "nodev";
      efiSupport = true;
      efiInstallAsRemovable = true;
    };
  };

  fileSystems."/boot" = {
    device = lib.mkForce "/dev/vda1";
    fsType = "vfat";
  };

  fileSystems."/" = {
    device = "/dev/disk/by-label/nixos";
    autoResize = true;
    fsType = "ext4";
    options = [
      "noatime"
      "nodiratime"
      "discard"
    ];
  };

  environment.systemPackages = import ./packages.nix { inherit pkgs unstablePkgs; };

  system.stateVersion = "26.05";
}
