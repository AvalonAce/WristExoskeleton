#!/usr/bin/env python3
"""Plot one csv_logger run: EMG envelopes vs wrist angular velocity.

Usage: python3 analysis/plot_run.py ~/exo_runs/20261022_113000_flex_reps [--axis gx|gy|gz] [--save]

Figures:
  1. Stacked time series: flexor, extensor (smoothed), wrist angular velocity, with Enter-markers.
  2. Onset comparison: first threshold crossing after each marker for flexor / extensor / gyro.
  3. Correlation: (flexor - extensor) vs angular velocity scatter, and cross-correlation lag.
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

EMG_SMOOTH_S = 0.05      # moving-average window on the (already enveloped) EMG
BASELINE_S = 2.0         # first N seconds assumed rest -> noise floor
K_SIGMA = 5.0            # onset threshold = mean + K_SIGMA * std of baseline
GYRO_THRESH = 0.3        # rad/s, onset threshold for wrist velocity


def load(run_dir):
    emg = pd.read_csv(os.path.join(run_dir, 'emg.csv'))
    hand = pd.read_csv(os.path.join(run_dir, 'imu_hand.csv'))
    fore_p = os.path.join(run_dir, 'imu_forearm.csv')
    fore = pd.read_csv(fore_p) if os.path.exists(fore_p) else None
    ev_p = os.path.join(run_dir, 'events.csv')
    events = pd.read_csv(ev_p) if os.path.exists(ev_p) else pd.DataFrame(columns=['t', 'event'])
    meta_p = os.path.join(run_dir, 'meta.json')
    meta = json.load(open(meta_p)) if os.path.exists(meta_p) else {}
    return emg, hand, fore, events, meta


def smooth(x, fs, win_s):
    n = max(1, int(fs * win_s))
    return pd.Series(x).rolling(n, center=True, min_periods=1).mean().to_numpy()


def wrist_velocity(hand, fore, axis):
    """Hand gyro minus forearm gyro (interpolated onto hand timestamps) -> wrist-only rotation."""
    w = hand[axis].to_numpy()
    if fore is not None and len(fore) > 10:
        w = w - np.interp(hand['t'], fore['t'], fore[axis])
    return w


def pick_axis(hand):
    """Axis with largest gyro variance = the one the wrist moved about in this run."""
    return max(['gx', 'gy', 'gz'], key=lambda a: hand[a].var())


def onset_after(t, x, t_mark, thresh, window=2.0):
    """First time after t_mark (within window s) that x exceeds thresh. NaN if none."""
    m = (t >= t_mark) & (t <= t_mark + window) & (np.abs(x) > thresh)
    idx = np.flatnonzero(m)
    return t[idx[0]] if len(idx) else np.nan


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('run_dir')
    ap.add_argument('--axis', default=None, help='gyro axis for flex/ext (default: auto)')
    ap.add_argument('--save', action='store_true', help='write PNGs into run_dir')
    args = ap.parse_args()

    emg, hand, fore, events, meta = load(args.run_dir)
    if len(emg) == 0 or len(hand) == 0:
        sys.exit('empty emg.csv or imu_hand.csv')

    t0 = min(emg['t'].iloc[0], hand['t'].iloc[0])
    te = emg['t'].to_numpy() - t0
    th = hand['t'].to_numpy() - t0
    tm = events['t'].to_numpy() - t0 if len(events) else np.array([])

    fs_emg = 1.0 / np.median(np.diff(te))
    flex = smooth(emg['flexor'].to_numpy(), fs_emg, EMG_SMOOTH_S)
    ext = smooth(emg['extensor'].to_numpy(), fs_emg, EMG_SMOOTH_S)

    axis = args.axis or pick_axis(hand)
    w = wrist_velocity(hand, fore, axis)
    title = f"{os.path.basename(args.run_dir)}  {meta.get('label', '')}  (gyro axis {axis})"

    # ---- Fig 1: time series
    fig1, ax = plt.subplots(3, 1, sharex=True, figsize=(12, 7))
    ax[0].plot(te, flex, lw=0.8, c='C3'); ax[0].set_ylabel('flexor\n(ADC)')
    ax[1].plot(te, ext, lw=0.8, c='C0'); ax[1].set_ylabel('extensor\n(ADC)')
    ax[2].plot(th, w, lw=0.8, c='k'); ax[2].set_ylabel(f'wrist ω {axis}\n(rad/s)')
    ax[2].axhline(0, c='gray', lw=0.5)
    for a in ax:
        for m in tm:
            a.axvline(m, c='g', ls='--', lw=0.7, alpha=0.7)
    ax[2].set_xlabel('time (s)'); fig1.suptitle(title); fig1.tight_layout()

    # ---- Fig 2: onset per marker
    base = te < BASELINE_S
    thr_f = flex[base].mean() + K_SIGMA * flex[base].std()
    thr_e = ext[base].mean() + K_SIGMA * ext[base].std()
    rows = []
    for m in tm:
        rows.append({'marker': m,
                     'flexor': onset_after(te, flex - flex[base].mean(), m, thr_f - flex[base].mean()),
                     'extensor': onset_after(te, ext - ext[base].mean(), m, thr_e - ext[base].mean()),
                     'gyro': onset_after(th, w, m, GYRO_THRESH)})
    onsets = pd.DataFrame(rows)
    if len(onsets):
        onsets['flexor-gyro (ms)'] = (onsets['flexor'] - onsets['gyro']) * 1e3
        onsets['extensor-gyro (ms)'] = (onsets['extensor'] - onsets['gyro']) * 1e3
        print('\nOnsets (s from start); negative lag = EMG before movement:')
        print(onsets.round(3).to_string(index=False))
        print(f"\nthresholds: flexor {thr_f:.0f}, extensor {thr_e:.0f} (ADC), gyro {GYRO_THRESH} rad/s")
        fig2, ax2 = plt.subplots(figsize=(7, 4))
        ax2.boxplot([onsets['flexor-gyro (ms)'].dropna(), onsets['extensor-gyro (ms)'].dropna()],
                    tick_labels=['flexor − gyro', 'extensor − gyro'])
        ax2.axhline(0, c='gray', lw=0.5); ax2.set_ylabel('onset lag (ms)')
        ax2.set_title('EMG onset relative to movement onset'); fig2.tight_layout()
    else:
        print('no markers in events.csv -> skipping per-rep onset table (press Enter during runs)')
        fig2 = None

    # ---- Fig 3: correlation of EMG difference with wrist velocity
    wi = np.interp(te, th, w)                       # gyro on EMG time base
    diff = (flex - flex[base].mean()) - (ext - ext[base].mean())
    r = np.corrcoef(diff, wi)[0, 1]
    # cross-correlation lag (positive = EMG leads gyro)
    d0 = (diff - diff.mean()) / (diff.std() + 1e-9)
    w0 = (wi - wi.mean()) / (wi.std() + 1e-9)
    max_lag = int(0.5 * fs_emg)
    lags = np.arange(-max_lag, max_lag + 1)
    xc = np.array([np.mean(d0[max(0, -l):len(d0) - max(0, l)] * w0[max(0, l):len(w0) - max(0, -l)])
                   for l in lags])
    best = lags[np.argmax(np.abs(xc))] / fs_emg * 1e3
    print(f"\nflexor-extensor vs ω: r = {r:.2f}, peak |xcorr| at EMG lead = {best:.0f} ms")

    fig3, ax3 = plt.subplots(1, 2, figsize=(11, 4))
    ax3[0].scatter(wi[::10], diff[::10], s=3, alpha=0.4)
    ax3[0].set_xlabel(f'wrist ω {axis} (rad/s)'); ax3[0].set_ylabel('flexor − extensor (ADC)')
    ax3[0].set_title(f'r = {r:.2f}')
    ax3[1].plot(lags / fs_emg * 1e3, xc); ax3[1].axvline(best, c='r', ls='--')
    ax3[1].set_xlabel('EMG lead (ms)'); ax3[1].set_ylabel('norm. xcorr')
    ax3[1].set_title(f'peak at {best:.0f} ms'); fig3.tight_layout()

    if args.save:
        fig1.savefig(os.path.join(args.run_dir, 'timeseries.png'), dpi=150)
        if fig2: fig2.savefig(os.path.join(args.run_dir, 'onsets.png'), dpi=150)
        fig3.savefig(os.path.join(args.run_dir, 'correlation.png'), dpi=150)
        print(f'saved PNGs to {args.run_dir}')
    plt.show()


if __name__ == '__main__':
    main()
