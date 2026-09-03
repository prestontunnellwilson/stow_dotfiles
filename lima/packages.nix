# After editing this file, run `just apply` on the host.
{ pkgs, unstablePkgs }:
with pkgs; [
  atuin
  unstablePkgs.claude-code
  unstablePkgs.codex
  difftastic
  ghostty.terminfo
  git
  helix
  jujutsu
  mise
  nil
  nixpkgs-fmt
  unstablePkgs.pi-coding-agent
  stow
  watchexec
  zellij
]

