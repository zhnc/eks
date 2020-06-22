#!/usr/bin/env python3

from aws_cdk import core
from aws_cdk import aws_ec2
from aws_cdk.core import Tag

from eks.vpc_stack import VpcStack
from eks.eks_stack import EksStack

from eks.ec2_stack import Ec2Stack


jenkins_ami = aws_ec2.MachineImage.latest_amazon_linux(
    generation=aws_ec2.AmazonLinuxGeneration.AMAZON_LINUX,
    edition=aws_ec2.AmazonLinuxEdition.STANDARD,
    virtualization=aws_ec2.AmazonLinuxVirt.HVM,
    storage=aws_ec2.AmazonLinuxStorage.GENERAL_PURPOSE
)
print(jenkins_ami)

env = core.Environment(account="716414967168", region="us-west-2")

props = {"key_name": "poc-zhnc"}
app = core.App()

Tag.add(app, "ENV", "STG")

VpcStack(app, "vpc", props=props, env=env)

EksStack(app, "eks", props=props, env=env)

Ec2Stack(app, "ec2",
         jenkins_ami=jenkins_ami, props=props, env=env
         )

app.synth()
