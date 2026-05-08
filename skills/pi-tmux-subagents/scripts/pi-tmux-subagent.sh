#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage: scripts/pi-tmux-subagent.sh <command> [options]

Run Pi as an observable tmux sub-agent and manage the resulting artifacts.

Commands:
  spawn-json          Start a one-shot `pi --mode json -p` child in tmux
  spawn-interactive   Start an interactive child Pi session in tmux
  final               Extract final assistant text from events.jsonl
  status              Print artifact status as JSON
  list                List pi-* tmux sessions as JSON lines
  capture             Capture recent tmux pane output
  send                Send a follow-up prompt to an interactive child
  kill                Kill a tmux child session

Common spawn options:
  --prompt FILE       Prompt file for the child Pi session (required)
  --name NAME         Human-readable run name (default: subagent)
  --cwd DIR           Working directory for child Pi (default: current directory)
  --dir DIR           Artifact directory (default: <cwd>/.pi/subagents/<timestamp>-<name>)
  --keep-resources    Do not pass --no-extensions --no-skills --no-prompt-templates
  --model MODEL       Pass --model MODEL to child Pi
  --tools TOOLS       Pass --tools TOOLS to child Pi

spawn-json options:
  --save-session      Save child session files under <dir>/sessions instead of --no-session

Other command options:
  --dir DIR           Artifact directory for final/status; optional for kill to mark status killed
  --session NAME      tmux session for capture/send/kill
  --lines N           capture line count (default: 120)
  --message TEXT      message for send

Examples:
  scripts/pi-tmux-subagent.sh spawn-json --name review --prompt .pi/subagents/review/prompt.md
  scripts/pi-tmux-subagent.sh spawn-interactive --name debug --prompt /tmp/debug-prompt.md
  scripts/pi-tmux-subagent.sh final --dir .pi/subagents/20260507-120000-review
  scripts/pi-tmux-subagent.sh capture --session pi-20260507-120000-review --lines 80
  scripts/pi-tmux-subagent.sh send --session pi-20260507-120000-debug --message 'Summarize and stop.'

Output:
  spawn-json, spawn-interactive, status, list, send, and kill write JSON/JSONL to stdout.
  capture and final write human-readable text to stdout.
  diagnostics and errors go to stderr.
EOF
}

err() {
	printf 'Error: %s\n' "$*" >&2
}

need() {
	command -v "$1" >/dev/null 2>&1 || {
		err "Required command not found: $1"
		exit 127
	}
}

require_value() {
	local option="$1"
	local value="${2-}"
	local remaining="$3"
	if (( remaining < 2 )) || [[ -z "$value" ]]; then
		err "$option requires a value"
		exit 2
	fi
}

abs_path() {
	local input="$1"
	case "$input" in
		~) input="$HOME" ;;
		~/*) input="$HOME/${input#~/}" ;;
	esac

	if command -v realpath >/dev/null 2>&1; then
		realpath "$input" 2>/dev/null && return 0
	fi

	case "$input" in
		/*) printf '%s\n' "$input" ;;
		*) printf '%s\n' "$PWD/$input" ;;
	esac
}

json_string() {
	need jq
	printf '%s' "$(jq -Rn --arg value "$1" '$value')"
}

json_field() {
	printf '"%s":' "$1"
	json_string "$2"
}

json_bool_field() {
	printf '"%s":%s' "$1" "$2"
}

safe_name() {
	printf '%s' "$1" | tr -cs '[:alnum:]_.-' '-' | sed -E 's/^-+//; s/-+$//; s/-+/-/g'
}

sh_quote() {
	printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\''/g")"
}

tmux_has_session() {
	tmux has-session -t "$1" >/dev/null 2>&1
}

emit_spawn_json() {
	printf '{'
	json_field session "$1"
	printf ','
	json_field dir "$2"
	printf ','
	json_field mode "$3"
	printf ','
	json_field status running
	printf '}\n'
}

parse_spawn_args() {
	name="subagent"
	cwd="$PWD"
	dir=""
	prompt=""
	clean="1"
	model=""
	tools=""
	save_session="0"

	while (($#)); do
		case "$1" in
			--name)
				require_value "$1" "${2-}" "$#"
				name="$2"
				shift 2
				;;
			--cwd)
				require_value "$1" "${2-}" "$#"
				cwd="$2"
				shift 2
				;;
			--dir)
				require_value "$1" "${2-}" "$#"
				dir="$2"
				shift 2
				;;
			--prompt)
				require_value "$1" "${2-}" "$#"
				prompt="$2"
				shift 2
				;;
			--keep-resources)
				clean="0"
				shift
				;;
			--model)
				require_value "$1" "${2-}" "$#"
				model="$2"
				shift 2
				;;
			--tools)
				require_value "$1" "${2-}" "$#"
				tools="$2"
				shift 2
				;;
			--save-session)
				save_session="1"
				shift
				;;
			--help|-h)
				usage
				exit 0
				;;
			*)
				err "Unknown spawn option: $1"
				exit 2
				;;
		esac
	done

	[[ -n "$prompt" ]] || { err '--prompt FILE is required'; exit 2; }
	[[ -f "$prompt" ]] || { err "Prompt file does not exist: $prompt"; exit 66; }
	cwd="$(abs_path "$cwd")"
	prompt="$(abs_path "$prompt")"
	if [[ -z "$dir" ]]; then
		stamp="$(date +%Y%m%d-%H%M%S)"
		dir="$cwd/.pi/subagents/$stamp-$(safe_name "$name")"
	fi
	dir="$(abs_path "$dir")"
}

write_json_command() {
	mkdir -p "$dir"
	[[ "$save_session" == "1" ]] && mkdir -p "$dir/sessions"
	cat > "$dir/command.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'echo failed > "$PI_TMUX_DIR/status"' ERR

echo running > "$PI_TMUX_DIR/status"

args=(--mode json -p)
if [[ "$PI_TMUX_CLEAN" == "1" ]]; then
	args+=(--no-extensions --no-skills --no-prompt-templates)
fi
if [[ "$PI_TMUX_SAVE_SESSION" == "1" ]]; then
	args+=(--session-dir "$PI_TMUX_DIR/sessions")
else
	args+=(--no-session)
fi
if [[ -n "$PI_TMUX_MODEL" ]]; then
	args+=(--model "$PI_TMUX_MODEL")
fi
if [[ -n "$PI_TMUX_TOOLS" ]]; then
	args+=(--tools "$PI_TMUX_TOOLS")
fi

pi "${args[@]}" @"$PI_TMUX_PROMPT" \
	2> "$PI_TMUX_DIR/stderr.log" \
	| tee "$PI_TMUX_DIR/events.jsonl"

echo complete > "$PI_TMUX_DIR/status"
EOF
	chmod +x "$dir/command.sh"
}

write_interactive_command() {
	mkdir -p "$dir/sessions"
	cat > "$dir/command.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
trap 'echo failed > "$PI_TMUX_DIR/status"' ERR

echo running > "$PI_TMUX_DIR/status"

args=(--session-dir "$PI_TMUX_DIR/sessions")
if [[ "$PI_TMUX_CLEAN" == "1" ]]; then
	args+=(--no-extensions --no-skills --no-prompt-templates)
fi
if [[ -n "$PI_TMUX_MODEL" ]]; then
	args+=(--model "$PI_TMUX_MODEL")
fi
if [[ -n "$PI_TMUX_TOOLS" ]]; then
	args+=(--tools "$PI_TMUX_TOOLS")
fi

pi "${args[@]}" @"$PI_TMUX_PROMPT"

echo complete > "$PI_TMUX_DIR/status"
EOF
	chmod +x "$dir/command.sh"
}

write_launcher() {
	cat > "$dir/launcher.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
export PI_TMUX_DIR=$(sh_quote "$dir")
export PI_TMUX_PROMPT=$(sh_quote "$prompt")
export PI_TMUX_CLEAN=$(sh_quote "$clean")
export PI_TMUX_MODEL=$(sh_quote "$model")
export PI_TMUX_TOOLS=$(sh_quote "$tools")
export PI_TMUX_SAVE_SESSION=$(sh_quote "$save_session")
exec bash $(sh_quote "$dir/command.sh")
EOF
	chmod +x "$dir/launcher.sh"
}

spawn_tmux() {
	mode="$1"
	need jq
	need tmux
	need pi
	need bash
	session="pi-$(basename "$dir")"
	if tmux_has_session "$session"; then
		err "tmux session already exists: $session"
		exit 73
	fi
	write_launcher
	tmux new-session -d -s "$session" -c "$cwd"
	tmux set-option -t "$session" remain-on-exit on >/dev/null
	tmux pipe-pane -o -t "$session" "cat >> $(sh_quote "$dir/pane.log")"
	tmux respawn-pane -k -t "$session" -c "$cwd" "bash $(sh_quote "$dir/launcher.sh")"
	emit_spawn_json "$session" "$dir" "$mode"
}

spawn_json() {
	parse_spawn_args "$@"
	write_json_command
	spawn_tmux json
}

spawn_interactive() {
	parse_spawn_args "$@"
	write_interactive_command
	spawn_tmux interactive
}

cmd_final() {
	dir=""
	while (($#)); do
		case "$1" in
			--dir)
				require_value "$1" "${2-}" "$#"
				dir="$2"
				shift 2
				;;
			--help|-h)
				usage
				exit 0
				;;
			*)
				err "Unknown final option: $1"
				exit 2
				;;
		esac
	done
	[[ -n "$dir" ]] || { err '--dir DIR is required'; exit 2; }
	events="$dir/events.jsonl"
	[[ -f "$events" ]] || { err "Missing events file: $events"; exit 66; }
	need jq
	jq -rs '
		[
			.[]
			| select(.type == "message_end" and .message.role == "assistant")
			| [ .message.content[]? | select(.type == "text") | .text ]
			| select(length > 0)
		]
		| last // []
		| .[]
	' "$events"
}

cmd_status() {
	dir=""
	while (($#)); do
		case "$1" in
			--dir)
				require_value "$1" "${2-}" "$#"
				dir="$2"
				shift 2
				;;
			--help|-h)
				usage
				exit 0
				;;
			*)
				err "Unknown status option: $1"
				exit 2
				;;
		esac
	done
	[[ -n "$dir" ]] || { err '--dir DIR is required'; exit 2; }
	abs_dir="$(abs_path "$dir")"
	status="unknown"
	[[ -f "$dir/status" ]] && status="$(tr -d '\n' < "$dir/status")"
	if [[ "$status" == "running" ]] && command -v tmux >/dev/null 2>&1; then
		session="pi-$(basename "$abs_dir")"
		if ! tmux_has_session "$session"; then
			status="exited"
		fi
	fi
	printf '{'
	json_field dir "$abs_dir"
	printf ','
	json_field status "$status"
	printf ','
	json_field events "$dir/events.jsonl"
	printf ','
	json_field stderr "$dir/stderr.log"
	printf ','
	json_field paneLog "$dir/pane.log"
	printf '}\n'
}

cmd_list() {
	need tmux
	while IFS= read -r session; do
		case "$session" in
			pi-*)
				printf '{'
				json_field session "$session"
				printf '}\n'
				;;
		esac
	done < <(tmux list-sessions -F '#S' 2>/dev/null || true)
}

cmd_capture() {
	session=""
	lines="120"
	while (($#)); do
		case "$1" in
			--session)
				require_value "$1" "${2-}" "$#"
				session="$2"
				shift 2
				;;
			--lines)
				require_value "$1" "${2-}" "$#"
				lines="$2"
				shift 2
				;;
			--help|-h)
				usage
				exit 0
				;;
			*)
				err "Unknown capture option: $1"
				exit 2
				;;
		esac
	done
	[[ -n "$session" ]] || { err '--session NAME is required'; exit 2; }
	need tmux
	tmux capture-pane -pt "$session" -S "-$lines"
}

cmd_send() {
	session=""
	message=""
	while (($#)); do
		case "$1" in
			--session)
				require_value "$1" "${2-}" "$#"
				session="$2"
				shift 2
				;;
			--message)
				require_value "$1" "${2-}" "$#"
				message="$2"
				shift 2
				;;
			--help|-h)
				usage
				exit 0
				;;
			*)
				err "Unknown send option: $1"
				exit 2
				;;
		esac
	done
	[[ -n "$session" ]] || { err '--session NAME is required'; exit 2; }
	[[ -n "$message" ]] || { err '--message TEXT is required'; exit 2; }
	need tmux
	buffer="pi-subagent-send-$$"
	tmux set-buffer -b "$buffer" -- "$message"
	tmux paste-buffer -t "$session" -b "$buffer"
	tmux delete-buffer -b "$buffer" >/dev/null 2>&1 || true
	tmux send-keys -t "$session" C-m
	printf '{'
	json_field session "$session"
	printf ','
	json_bool_field sent true
	printf '}\n'
}

cmd_kill() {
	session=""
	dir=""
	while (($#)); do
		case "$1" in
			--session)
				require_value "$1" "${2-}" "$#"
				session="$2"
				shift 2
				;;
			--dir)
				require_value "$1" "${2-}" "$#"
				dir="$2"
				shift 2
				;;
			--help|-h)
				usage
				exit 0
				;;
			*)
				err "Unknown kill option: $1"
				exit 2
				;;
		esac
	done
	[[ -n "$session" ]] || { err '--session NAME is required'; exit 2; }
	need tmux
	tmux kill-session -t "$session"
	if [[ -n "$dir" ]]; then
		mkdir -p "$dir"
		echo killed > "$dir/status"
	fi
	printf '{'
	json_field session "$session"
	printf ','
	json_bool_field killed true
	printf '}\n'
}

main() {
	cmd="${1:-}"
	[[ -n "$cmd" ]] || { usage; exit 2; }
	shift || true
	case "$cmd" in
		spawn-json) spawn_json "$@" ;;
		spawn-interactive) spawn_interactive "$@" ;;
		final) cmd_final "$@" ;;
		status) cmd_status "$@" ;;
		list) cmd_list "$@" ;;
		capture) cmd_capture "$@" ;;
		send) cmd_send "$@" ;;
		kill) cmd_kill "$@" ;;
		--help|-h|help) usage ;;
		*) err "Unknown command: $cmd"; usage >&2; exit 2 ;;
	esac
}

main "$@"
