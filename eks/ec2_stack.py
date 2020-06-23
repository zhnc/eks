from aws_cdk import (
    aws_ec2 as ec2,
    aws_iam as iam,
    aws_eks as eks,
    core
)

with open("./user_data/attach_ebs.sh") as f:
    user_data = f.read()


class Ec2Stack(core.Stack):

    def __init__(self, scope: core.Construct, id: str, jenkins_ami: str, props, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)

        key_name = proos['key_name']
        self.vpc = props['vpc']
        # sg-jenkins
        sgjenkins = ec2.SecurityGroup(self, "sg_jenkins", vpc=self.vpc, allow_all_outbound=True,
                                      security_group_name="sg_jenkins", description="sg_jenkins")
        #   sg.add_ingress_rule(peer=ec2.Peer.any_ipv4, connection=ec2.Port.tcp(22), description='测试22使用')
        sgjenkins.add_ingress_rule(peer=ec2.Peer.ipv4(
            '0.0.0.0/0'), connection=ec2.Port.tcp(22), description='sg_jenkins')
        sgjenkins.add_ingress_rule(peer=ec2.Peer.ipv4(
            '119.123.34.135/32'), connection=ec2.Port.tcp(80), description='sg_jenkins')

        role_ssm = iam.Role(
            self, "InstanceSSM", assumed_by=iam.ServicePrincipal("ec2.amazonaws.com"))
        role_ssm.add_managed_policy(iam.ManagedPolicy.from_aws_managed_policy_name(
            "service-role/AmazonEC2RoleforSSM"))

        self.jenkins_vm = ec2.Instance(self, 'jenkins',
                                       vpc=self.vpc,
                                       instance_type=ec2.InstanceType(
                                           instance_type_identifier="m5.large"),
                                       machine_image=jenkins_ami,
                                       block_devices=[ec2.BlockDevice(
                                           device_name="/dev/xvda",
                                           volume=ec2.BlockDeviceVolume.ebs(10,
                                                                            encrypted=True
                                                                            )
                                       ),
                                           ec2.BlockDevice(
                                           device_name="/dev/sdb",
                                           volume=ec2.BlockDeviceVolume.ebs(100,
                                                                            encrypted=True
                                                                            )
                                       )
                                       ],
                                       instance_name="jenkins",
                                       key_name=key_name,
                                       role=role_ssm,
                                       user_data=ec2.UserData.custom(
                                           user_data),
                                       security_group=sgjenkins,
                                       vpc_subnets=ec2.SubnetSelection(
                                           subnet_type=ec2.SubnetType.PUBLIC)
                                       )

        self.bastion_vm = ec2.Instance(self, 'eks-Bastion',
                                       vpc=self.vpc,
                                       instance_type=ec2.InstanceType(
                                           instance_type_identifier="m5.large"),
                                       machine_image=jenkins_ami,
                                       block_devices=[ec2.BlockDevice(
                                           device_name="/dev/xvda",
                                           volume=ec2.BlockDeviceVolume.ebs(10,
                                                                            encrypted=True
                                                                            )
                                       ), ec2.BlockDevice(
                                           device_name="/dev/sdb",
                                           volume=ec2.BlockDeviceVolume.ebs(100,
                                                                            encrypted=True
                                                                            )
                                       )],
                                       instance_name="eks-Bastion",
                                       key_name=key_name,
                                       role=role_ssm,
                                       user_data=ec2.UserData.custom(
                                           user_data),
                                       security_group=sgjenkins,
                                       vpc_subnets=ec2.SubnetSelection(
                                           subnet_type=ec2.SubnetType.PUBLIC)
                                       )
