#!/usr/bin/env python3

from aws_cdk import core

from eks.eks_stack import EksStack


app = core.App()
EksStack(app, "eks")

app.synth()
