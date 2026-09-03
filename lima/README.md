## NixOS Lima config

A general-purpose NixOS development VM managed by [Lima](https://lima-vm.io/),
based on <https://github.com/nixos-lima/nixos-lima-config-sample/tree/e452960dc46fef34435b3b14279d88a7f460156e>.
I want this config to be within my config/dotfiles directory, so I didn't fork their repo.
Inspiration and information also comes from:

- <https://www.joshkasuboski.com/posts/nix-dev-environment/>
- <https://jvns.ca/blog/2023/07/10/lima--a-nice-way-to-run-linux-vms-on-mac/>
- <https://www.metachris.dev/2025/11/sandbox-your-ai-dev-tools-a-practical-guide-for-vms-and-lima/>

Deliberately project-agnostic. Anything a single application needs — its
mounts, its port forwards, proxies to its services, credentials it reads at
start-up — belongs with that application, not here. See
[Layering a project on top](#layering-a-project-on-top).

### Installation

Install `lima` and `just`.
With `brew`, this would be

```sh
brew install lima just
```

`mounts` is empty by default, so the VM sees nothing of the host. Add the
directories you want shared before creating the VM:

```yaml
mounts:
  - location: "~/git/some-project"
    mountPoint: "/home/{{.User}}.guest/git/some-project"
    writable: true
```

### VM creation

Run

```sh
just create
just shell
```

### What's set up

- **`nix-ld`**, so upstream prebuilt binaries run: anything `mise` installs, and
  the bundled node an editor or coding agent's remote-ssh server ships with.
- **`mise`** for language toolchains, with its shims on `PATH` for
  non-interactive shells too, so `just` recipes and `limactl shell -- <cmd>`
  see them. `/etc/mise/config.toml` sets `node.compile = false`, because mise
  otherwise decides this host cannot run a prebuilt node and spends the better
  part of an hour building it from source.
- **A pinned ssh port** (`ssh.localPort`), because Lima otherwise picks a random
  host port on every start, which breaks anything that remembers a connection.
  Lima writes a ready-made block to `~/.lima/<instance>/ssh.config` and
  regenerates it on each start, so reference it rather than copying it — add
  `Include ~/.lima/*/ssh.config` near the top of `~/.ssh/config`, above any
  `Host *` block. Then `ssh lima-nix-dev` works from anywhere, and any app that
  takes a remote-ssh host accepts `lima-nix-dev`.
- **`virtiofs`** mounts, considerably faster than 9p on a large source tree.
- **fish** as the login shell, with starship.

### Layering a project on top

A project's VM needs things this config should not know about. Rather than
accumulating them here, keep a copy of these files with the project.

The rule of thumb: if removing the project would make a line pointless, that
line belongs with the project.

### Changing the config

`flake.nix`, `flake.lock`, `nixos-lima-config.nix`, and `packages.nix` are copied
into the VM by `just apply`. Everything in `nixos.yaml` — mounts, port forwards,
ssh, CPU and memory — is only read when the instance is *created*. For an
existing instance, edit `nixos.yaml` and then repeat the change in Lima's saved
copy:

```sh
just edit   # stops the VM, opens ~/.lima/nix-dev/lima.yaml, restarts it
```

### Updating

```sh
just update   # refresh flake.lock inside the VM, copy it back, re-apply
```

### Differences from the sample config

- Rather than using home-manager, I rely on `stow` for a majority of my dotfile management, which is what I use in other environments.
- `just` rather than setup shell scripts for provisioning and updates
- Focuses on my user, name, and architecture rather than being more general purpose.
- Only share specific directories (none by default) rather than giving access to all of my computer.
- Packages are listed in `packages.nix` rather than being spread across `nixos-lima-config.yaml` and home manager
