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

  # limactl shell forwards TERM with its pseudo-terminal, but not COLORTERM.
  # Declare the VM's true-color support so Helix uses its full default theme.
  environment.sessionVariables = {
    COLORTERM = "truecolor";
    EDITOR = "hx";
    VISUAL = "hx";
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

