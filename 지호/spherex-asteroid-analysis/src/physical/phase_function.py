"""Asteroid photometric phase functions.

H-G  (Bowell et al. 1989, IAU 1985 system), two-term exponential approximation:
    Phi_i(alpha) = exp(-A_i * tan(alpha/2)^B_i),  A1=3.33 B1=0.63, A2=1.87 B2=1.22
    Phi(alpha)   = (1 - G) Phi_1 + G Phi_2           (valid for 0 <= alpha < 120 deg)
H-G1-G2 (Muinonen et al. 2010): delegated to sbpy (cubic-spline basis functions);
    reported as unavailable if sbpy is not installed rather than approximated.
Reduced magnitude:  V(1,1,alpha) = m - 5 log10(r * Delta)
Model:              V(1,1,alpha) = H - 2.5 log10(Phi(alpha))
"""
from __future__ import annotations

import numpy as np

A1, B1, A2, B2 = 3.33, 0.63, 1.87, 1.22


def hg_phi(alpha_deg, G):
    a = np.radians(np.asarray(alpha_deg, float))
    t = np.tan(a / 2.0)
    phi1 = np.exp(-A1 * t ** B1)
    phi2 = np.exp(-A2 * t ** B2)
    return (1.0 - G) * phi1 + G * phi2


def hg_reduced_mag(alpha_deg, H, G):
    return H - 2.5 * np.log10(hg_phi(alpha_deg, G))


def phase_integral_q(G: float) -> float:
    """Phase integral for the H-G system (Bowell et al. 1989): q = 0.290 + 0.684 G."""
    return 0.290 + 0.684 * G


def hg1g2_available() -> bool:
    try:
        from sbpy.photometry import HG1G2  # noqa: F401
        return True
    except Exception:
        return False


def hg1g2_reduced_mag(alpha_deg, H, G1, G2):
    """Reduced magnitude in the H-G1-G2 system via sbpy (phase angle passed in radians)."""
    from sbpy.photometry import HG1G2
    return np.asarray(HG1G2.evaluate(np.radians(np.asarray(alpha_deg, float)), H, G1, G2), float)


def reduced_magnitude(m, r_au, delta_au):
    return np.asarray(m, float) - 5.0 * np.log10(np.asarray(r_au) * np.asarray(delta_au))
