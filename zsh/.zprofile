eval "$(/opt/homebrew/bin/brew shellenv)"

# Add paths to PATH.
if [[ -f '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh' ]]; then
  source '/nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh'
fi
