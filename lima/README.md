## NixOS Lima config

My NixOS lima config based on <https://github.com/nixos-lima/nixos-lima-config-sample/tree/e452960dc46fef34435b3b14279d88a7f460156e>.
I want this config to be within my config/dotfiles directory, so I didn't fork their repo.
Inspiration and information also comes from:

- <https://www.joshkasuboski.com/posts/nix-dev-environment/>
- <https://jvns.ca/blog/2023/07/10/lima--a-nice-way-to-run-linux-vms-on-mac/>
- <https://www.metachris.dev/2025/11/sandbox-your-ai-dev-tools-a-practical-guide-for-vms-and-lima/>

### Installation

Install `lima` and `just`.
With `brew`, this would be

```sh
brew install lima just
```

Additionally, enable the VM to see specific directories by replacing `mounts` in `nixos.yaml` with paths on the host and VM.
Example:

```yaml
mounts:
  - location: "~/git/datastar-f-sharp-experiment"
    mountPoint: "/home/{{.User}}.guest/git/datastar-f-sharp-experiment"
    writable: true
    9p:
      cache: "mmap"
  - location: "~/.dotfiles"
    mountPoint: "/home/{{.User}}.guest/.dotfiles"
    writable: false
    9p:
      cache: "mmap"
```

### VM creation

Run

```sh
just create
just shell
```

### Differences from the sample config

- Rather than using home-manager, I rely on `stow` for a majority of my dotfile management, which is what I use in other environments.
- `just` rather than setup shell scripts for provisioning and updates
- Focuses on my user, name, and architecture rather than being more general purpose.
- Only share specific directories (none by default) rather than giving access to all of my computer.
- Packages are listed in `packages.nix` rather than being spread across `nixos-lima-config.yaml` and home manager
