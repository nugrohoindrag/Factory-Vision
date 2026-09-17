package jsnum

import "testing"

func TestToFixedMatchesJavaScript(t *testing.T) {
	cases := []struct {
		in     float64
		digits int
		want   float64
	}{
		{0.125, 2, 0.13}, // exact tie rounds up, unlike Go's half-even
		{0.03125, 4, 0.0313},
		{1.005, 2, 1}, // 1.005 is below the tie in binary
		{87.29999, 1, 87.3},
		{2.5, 0, 3},
		{-2.5, 0, -3}, // half away from zero
		{0.8333333, 4, 0.8333},
		{100, 1, 100},
		{0, 4, 0},
	}
	for _, c := range cases {
		if got := ToFixed(c.in, c.digits); got != c.want {
			t.Errorf("ToFixed(%v, %d) = %v, want %v", c.in, c.digits, got, c.want)
		}
	}
}

func TestRoundMatchesMathRound(t *testing.T) {
	if Round(2.5) != 3 || Round(-2.5) != -2 || Round(0.49999) != 0 || Round(-0.5) != 0 {
		t.Fatalf("Round is not Math.round")
	}
}
