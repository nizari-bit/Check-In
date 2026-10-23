-- Active: 1783224834436@@127.0.0.1@3306@event_checkin
CREATE TABLE IF NOT EXISTS admins (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(190) NOT NULL,
    event_date DATE NOT NULL,
    venue VARCHAR(255) NULL,
    host_name VARCHAR(190) NULL,
    host_phone VARCHAR(50) NULL,
    host_email VARCHAR(190) NULL,
    notes TEXT NULL,
    card_template_path VARCHAR(255) NULL,
    card_name_x DECIMAL(8,2) NULL,
    card_name_y DECIMAL(8,2) NULL,
    card_name_width DECIMAL(8,2) NULL,
    card_name_font_size DECIMAL(8,2) NULL,
    card_name_font_family VARCHAR(100) NULL,
    card_name_font_variant VARCHAR(32) NULL,
    card_qr_x DECIMAL(8,2) NULL,
    card_qr_y DECIMAL(8,2) NULL,
    card_qr_size DECIMAL(8,2) NULL,
    access_token CHAR(48) NOT NULL UNIQUE,
    pin_hash VARCHAR(255) NOT NULL,
    access_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB;

CREATE TABLE IF NOT EXISTS guests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    code CHAR(7) NOT NULL UNIQUE,
    event_id INT NOT NULL,
    full_name VARCHAR(190) NOT NULL,
    phone VARCHAR(50) NULL,
    category VARCHAR(80) NULL,
    table_no VARCHAR(40) NULL,
    card_type ENUM('single', 'double') NOT NULL DEFAULT 'single',
    admitted_count TINYINT UNSIGNED NOT NULL DEFAULT 0,
    checked_in_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_guest_event FOREIGN KEY (event_id) REFERENCES events (id) ON DELETE CASCADE,
    INDEX idx_guest_event (event_id)
) ENGINE = InnoDB;