# After editing this file, run `just apply` on the host.
#
# Language toolchains deliberately are not here: mise installs them per project
# from a .tool-versions file, so the VM tracks whatever that project pins. See
# programs.nix-ld in nixos-lima-config.nix for what makes those runnable.
{ pkgs, unstablePkgs }:
with pkgs; [
  atuin
  unstablePkgs.claude-code
  unstablePkgs.codex
  difftastic
  ghostty.terminfo
  helix
  jujutsu
  mise
  nil
  nixpkgs-fmt
  unstablePkgs.pi-coding-agent
  stow
  watchexec
  zellij

  # General development tooling
  gnupg # mise verifies the signatures on the tarballs it downloads
  jq
  shellcheck
  unzip
]
