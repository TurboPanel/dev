# gate.jq: one tab-separated line per advisory group per package in an
# `osv-scanner scan --format json` report:
#
#   <BLOCK|warn>  <package>@<version>  <ids, comma-separated>  <score> <labels>  <fix available|no fix yet>
#
# BLOCK = rated HIGH or CRITICAL (osv-scanner's CVSS max_severity >= 7.0, or a
# database_specific.severity of HIGH/CRITICAL on any advisory in the group)
# AND a fixed version exists for this package (a "fixed" event in any affected
# range naming it). Everything else is "warn". An unrated advisory is "warn":
# the policy blocks only what is known to be high.

def score: (.max_severity // "") | (tonumber? // null);

.results // []
| .[]
| .packages[]
| .package as $pkg
| (reduce .vulnerabilities[] as $v ({}; .[$v.id] = $v)) as $byid
| .groups[]
| [ .ids[] | $byid[.] | select(. != null) ] as $vulns
| ([ $vulns[] | (.database_specific.severity? // empty) | ascii_upcase ] | unique) as $labels
| score as $score
| (($score != null and $score >= 7) or any($labels[]; . == "HIGH" or . == "CRITICAL")) as $high
| any(
    $vulns[]
    | .affected[]?
    | select(.package.name == $pkg.name and .package.ecosystem == $pkg.ecosystem)
    | .ranges[]?
    | .events[]?;
    has("fixed")
  ) as $fixed
| [
    (if $high and $fixed then "BLOCK" else "warn" end),
    "\($pkg.name)@\($pkg.version)",
    (.ids | join(",")),
    ("\($score // "?") \(if ($labels | length) == 0 then "unrated" else ($labels | join("/")) end)"),
    (if $fixed then "fix available" else "no fix yet" end)
  ]
| @tsv
