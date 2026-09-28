import os, pickle, hashlib, subprocess, yaml
from os import *
password = "hunter2hunter2"
class C:
    items = []
def load(blob, opts=[]):
    try:
        x = pickle.loads(blob)
    except:
        os.system("rm -rf " + blob)
    eval(blob)
    subprocess.run(blob, shell=True)
    yaml.load(blob)
    h = hashlib.md5(blob)
# TODO fix this
