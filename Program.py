import subprocess
import time

# List your scripts in order
scripts = [
    "DecodeData.py",
    "OrganizeData.py",
    "updateData.py"
]

# Time to sleep between scripts in seconds
sleep_seconds = 5

for script in scripts:
    print(f"Running {script} ...")
    result = subprocess.run(["python", script])
    if result.returncode != 0:
        print(f"Warning: {script} exited with code {result.returncode}")
    else:
        print(f"{script} completed successfully.")
    print(f"Sleeping for {sleep_seconds} seconds...\n")
    time.sleep(sleep_seconds)

print("All scripts finished.")
