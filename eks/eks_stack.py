from aws_cdk import (
    aws_ec2 as ec2,
    aws_iam as iam,
    aws_eks as eks,
    core
)

EKS_CLUSTER_NAME = "eks_demo"
key_name = "poc-zhnc"


class EksStack(core.Stack):

    def __init__(self, scope: core.Construct, id: str, props, **kwargs) -> None:
        super().__init__(scope, id, **kwargs)

       self.vpc = props['vpc']

        core.Tag.add(self.vpc, "kubernetes.io/cluster/" +
                     EKS_CLUSTER_NAME, "shared")
        public_selection = self.vpc.select_subnets(
            subnet_type=ec2.SubnetType.PUBLIC
        )
        for subnet in public_selection.subnets:
            core.Tag.add(subnet, "kubernetes.io/cluster/" +
                         EKS_CLUSTER_NAME, "shared")
            core.Tag.add(subnet, "kubernetes.io/role/elb", "1")

        private_selection = self.vpc.select_subnets(
            subnet_type=ec2.SubnetType.PRIVATE
        )

        for subnet in private_selection.subnets:
            core.Tag.add(subnet, "kubernetes.io/cluster/" +
                         EKS_CLUSTER_NAME, "shared")
            core.Tag.add(subnet, "kubernetes.io/role/internal-elb", "1")

        cluster_admin = iam.Role(self, "AdminRole", assumed_by = iam.AccountRootPrincipal())

        cluster=eks.Cluster(self, EKS_CLUSTER_NAME,
                cluster_name = EKS_CLUSTER_NAME,
                default_capacity = 1,
                default_capacity_instance = ec2.InstanceType("m5.large"),
                masters_role = cluster_admin,
                vpc = self.vpc,
                vpc_subnets = [ec2.SubnetSelection(one_per_az=True,
                subnet_type=ec2.SubnetType.PUBLIC)],
                output_cluster_name = True
                )

        # add instance nodes
        asg=cluster.add_capacity("node_group",
                instance_type = ec2.InstanceType("m5.large"),
                desired_capacity = 3,
                key_name = key_name,
                max_capacity = 4,
                min_capacity = 1)

        asg=cluster.add_capacity("node_group_spot",
                instance_type = ec2.InstanceType("m5.large"),
                desired_capacity = 3,
                key_name = key_name,
                max_capacity = 4,
                min_capacity = 1,
                spot_price="1.0")




        
