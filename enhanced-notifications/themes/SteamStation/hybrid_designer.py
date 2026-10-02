#!/usr/bin/env python3
"""Convenience runner for SteamStation Hybrid Sound Designer."""
import os, sys

SFX_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sfx")
sys.path.insert(0, SFX_DIR)
import hybrid_sound_designer

if __name__ == "__main__":
    hybrid_sound_designer.main()
