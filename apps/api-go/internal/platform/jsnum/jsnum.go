// Package jsnum reproduces the JavaScript number formatting the Node API
// used for every derived figure, so a percentage the console showed as
// 87.3 is 87.3 here and not 87.29999.
//
// Number(x.toFixed(d)) is not math.Round(x*10^d)/10^d: toFixed rounds the
// exact binary value half away from zero, while a float multiply can land
// on either side of the tie. Math.round rounds half towards +∞.
package jsnum

import (
	"math"
	"math/big"
	"strconv"
)

// ToFixed is Number(x.toFixed(digits)).
func ToFixed(x float64, digits int) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	neg := x < 0
	if neg {
		x = -x
	}
	// n = the integer closest to x·10^digits, the larger one on a tie —
	// computed on the exact rational value of the float, as the spec does.
	r := new(big.Rat).SetFloat64(x)
	scale := new(big.Rat).SetInt(new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(digits)), nil))
	r.Mul(r, scale)
	r.Add(r, big.NewRat(1, 2))
	n := new(big.Int).Quo(r.Num(), r.Denom()) // floor for non-negative
	s := n.String()
	if digits > 0 {
		for len(s) <= digits {
			s = "0" + s
		}
		s = s[:len(s)-digits] + "." + s[len(s)-digits:]
	}
	v, _ := strconv.ParseFloat(s, 64)
	if neg {
		v = -v
	}
	return v
}

// Round is Math.round: half towards positive infinity.
func Round(x float64) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x
	}
	return math.Floor(x + 0.5)
}

// RoundInt is Math.round as an int.
func RoundInt(x float64) int { return int(Round(x)) }

// Round1 and Round4 are the two precisions the analytics use.
func Round1(x float64) float64 { return ToFixed(x, 1) }
func Round4(x float64) float64 { return ToFixed(x, 4) }

// Clamp01 pins a ratio to [0, 1].
func Clamp01(x float64) float64 { return math.Min(1, math.Max(0, x)) }

// Trunc is Math.trunc.
func Trunc(x float64) float64 { return math.Trunc(x) }
