#!/usr/bin/env bash
# Fake docker for ops/test/compose-check.spec.ts. Not the real thing.
D="$FAKE_DIR"
echo "docker $*" >> "$D/calls.log"
sc="$FAKE_SCENARIO"
state() { # state SERVICE -> "status health exit restarts"
  local s="$1" up=0
  [ -f "$D/up" ] && up=1
  [ "$up" = 1 ] || { echo "absent"; return; }
  case "$s:$sc" in
    migrate:stub | migrate:stub-strict) echo "exited - 78 0"; return ;;
    migrate:migrate-fail) echo "exited - 1 0"; return ;;
    migrate:*) echo "exited - 0 0"; return ;;
  esac
  case "$sc" in
    stub | stub-strict | migrate-fail)
      case "$s" in
        db | mail) echo "running healthy 0 0" ;;
        web) if [ -f "$D/web-up" ]; then echo "running healthy 0 0"; else echo "created - 0 0"; fi ;;
        *) echo "created - 0 0" ;;
      esac
      return ;;
    logic-unhealthy) [ "$s" = logic ] && { echo "running unhealthy 0 0"; return; } ;;
    slow) [ "$s" = logic ] && { echo "running starting 0 0"; return; } ;;
    worker-crash | worker-stub) [ "$s" = worker ] && { echo "running - 0 3"; return; } ;;
  esac
  case "$s" in
    worker) echo "running - 0 0" ;;
    *) echo "running healthy 0 0" ;;
  esac
}
args=("$@")
case "${args[0]}" in
  info) exit 0 ;;
  build | image) exit 0 ;;
  inspect)
    fmt=""; ids=()
    i=1
    while [ $i -lt ${#args[@]} ]; do
      if [ "${args[$i]}" = "-f" ]; then fmt="${args[$((i+1))]}"; i=$((i+2)); else ids+=("${args[$i]}"); i=$((i+1)); fi
    done
    for id in "${ids[@]}"; do
      svc="${id#id-}"
      case "$fmt" in
        *Labels*) read -r st he ex rs <<<"$(state "$svc")"; echo "$svc $st $he $ex $rs $id" ;;
        *) if [ "$sc" = data-net ]; then echo "p_edge p_data "; else echo "p_edge "; fi ;;
      esac
    done
    exit 0 ;;
  logs)
    id="${args[${#args[@]}-1]}"; svc="${id#id-}"
    if { [ "$svc" = migrate ] && { [ "$sc" = stub ] || [ "$sc" = stub-strict ]; }; } || { [ "$svc" = worker ] && [ "$sc" = worker-stub ]; }; then
      echo "glidepath/logic: dist/$svc.js is a stub (no build output). Rebuild once the entry exists."
    else
      echo "some real log line"
    fi
    exit 0 ;;
  compose)
    shift
    [ "$1" = version ] && exit 0
    while [ $# -gt 0 ]; do
      case "$1" in -p | --env-file | -f) shift 2 ;; *) break ;; esac
    done
    sub="$1"; shift
    # shellcheck disable=SC2086 # word splitting of FAKE_SERVICES is intended
    case "$sub" in
      config) printf '%s\n' $FAKE_SERVICES; exit 0 ;;
      down) rm -f "$D/up" "$D/web-up"; echo "down" >> "$D/order.log"; exit 0 ;;
      up)
        echo "up $*" >> "$D/order.log"
        touch "$D/up"
        case " $* " in *" --no-deps "*) touch "$D/web-up"; exit 0 ;; esac
        case "$sc" in
          stub | stub-strict) echo "service \"migrate\" didn't complete successfully: exit 78" >&2; exit 1 ;;
          migrate-fail) echo "service \"migrate\" didn't complete successfully: exit 1" >&2; exit 1 ;;
          logic-unhealthy) echo "container p-logic-1 is unhealthy" >&2; exit 1 ;;
        esac
        touch "$D/web-up"
        exit 0 ;;
      ps)
        [ -f "$D/up" ] || exit 0
        for s in $FAKE_SERVICES; do
          echo "id-$s"
        done
        exit 0 ;;
      exec)
        # INT-01: exec -T db psql ... -c SQL  /  exec -T web sh -c 'cat <css>'
        if [ "$2" = db ]; then
          sql="${*: -1}"
          echo "exec db psql" >> "$D/order.log"
          mig=tier3-data/migrations
          case "$sql" in
            *schema_migration*)
              { (cd "$mig" && ls -1 ./*.sql) | sed 's#^\./##'; (cd "$mig/manual" && ls -1 ./*.sql) | sed 's#^\./#manual/#'; } |
                if [ "$sc" = migration-missing ]; then sed '$d'; else cat; fi ;;
            *relrowsecurity*) if [ "$sc" = rls-missing ]; then echo "20|line_item"; else echo "20|"; fi ;;
            *pg_views*)
              grep -ohE 'CREATE (OR REPLACE )?VIEW [a-z_]+' "$mig"/*.sql "$mig"/manual/*.sql | awk '{print $NF}' |
                if [ "$sc" = view-missing ]; then grep -v v_dimension_members; else cat; fi ;;
            *"FROM tenant"*) if [ "$sc" = seed-missing ]; then echo 0; else echo 1; fi ;;
          esac
          exit 0
        fi
        if [ "$2" = web ] && [ "$3" = sh ]; then
          echo "exec web css" >> "$D/order.log"
          if [ "$sc" = tokens-missing ]; then echo ':root{--unrelated:1}'; else cat tier1-presentation/ui/src/tokens/tokens.css; fi
          exit 0
        fi
        # exec -T web getent hosts HOST
        host="${*: -1}"
        echo "exec getent hosts $host" >> "$D/order.log"
        case "$sc:$host" in
          no-getent:*) echo "exec: getent: not found" >&2; exit 127 ;;
          web-resolves-db:db) echo "172.20.0.2 db"; exit 0 ;;
        esac
        case "$host" in
          db | objects) exit 2 ;;
          logic | web) echo "172.19.0.3 $host"; exit 0 ;;
        esac
        exit 2 ;;
    esac
    exit 0 ;;
esac
exit 0
