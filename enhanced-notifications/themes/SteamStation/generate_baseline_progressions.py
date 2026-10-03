#!/usr/bin/env python3
"""Convenience runner for Baseline Trophy Audio Progression Designer."""
import os
import sys

SFX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sfx")
sys.path.insert(0, SFX_DIR)
import baseline_progression_designer

if __name__ == "__main__":
    baseline_progression_designer.generate_all()
