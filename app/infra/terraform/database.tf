resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-postgres"
  engine         = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class

  allocated_storage = var.db_allocated_storage_gb
  storage_type      = "gp3"
  storage_encrypted = true

  db_name  = "parakh"
  username = "parakh_admin"
  # RDS creates and rotates the master password in AWS Secrets Manager; it never appears in Terraform code.
  manage_master_user_password = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  multi_az               = false # enable in Stage B

  backup_retention_period    = var.db_backup_retention_days
  backup_window              = "20:00-21:00" # 01:30-02:30 IST
  maintenance_window         = "sun:21:00-sun:22:00"
  auto_minor_version_upgrade = true
  copy_tags_to_snapshot      = true

  deletion_protection       = var.enable_deletion_protection
  skip_final_snapshot       = !local.is_prod
  final_snapshot_identifier = local.is_prod ? "${local.name}-final" : null

  tags = { Name = "${local.name}-postgres" }
}
