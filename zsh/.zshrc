zstyle ':completion:*' completer _expand _complete _ignored
zstyle ':completion:*' list-colors ''
zstyle ':completion:*' list-prompt %SAt %p: Hit TAB for more, or the character to insert%s
zstyle ':completion:*' matcher-list '' 'm:{[:lower:]}={[:upper:]} r:|[.-_]=** r:|=** l:|=*'
zstyle ':completion:*' menu select=3
zstyle ':completion:*' original true
zstyle ':completion:*' select-prompt %SScrolling active: current selection at %p%s
zstyle :compinstall filename '/Users/prestontunnelwilson/.zshrc'

autoload -Uz compinit
autoload -U colors && colors
compinit
# End of lines added by compinstall
# Lines configured by zsh-newuser-install
HISTFILE=~/.histfile
HISTSIZE=10000
SAVEHIST=10000

setopt appendhistory autocd
unsetopt beep nomatch
#ignore duplicates
setopt HIST_IGNORE_DUPS

alias ls='gls --color=auto --group-directories-first'

eval "$(starship init zsh)"
export ASDF_DATA_DIR="$HOME/.asdf"
export PATH="$ASDF_DATA_DIR/shims:$PATH:$HOME/go/bin"
export EDITOR="hx"

GOV=$(asdf where golang)
# export GOROOT="$GOV/go"
export GOPATH="$HOME/go"
