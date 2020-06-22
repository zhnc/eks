#!/bin/bash

sudo yum install xfsprogs -y
sudo mkfs -t xfs /dev/nvme1n1
sudo mkdir /data
sudo mount /dev/nvme1n1 /data