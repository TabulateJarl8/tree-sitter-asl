; https://zed.dev/docs/extensions/languages#syntax-highlighting

(comment) @comment
(string) @string
[ (decimal_const) (octal_const) (hex_const) ] @number

(name_seg) @variable

(arg_term) @variable.parameter
[ (local_term) (debug) ] @variable.special

; methods

(method_term method_name: (name_string (name_path (name_seg) @function)))
(function_term function_name: (name_string (name_path (name_seg) @function)))

; types
(device_term device_name: (name_string (name_path (name_seg) @type)))
(scope_term location: (name_string (name_path (name_seg) @type)))
(processor_term processor_name: (name_string (name_path (name_seg) @type)))
(thermal_zone_term thermal_zone_name: (name_string (name_path (name_seg) @type)))
(power_res_term resource_name: (name_string (name_path (name_seg) @type)))

; constants
(op_region_term region_name: (name_string (name_path (name_seg) @constant)))
(mutex_term mutex_name: (name_string (name_path (name_seg) @constant)))
(event_term event_name: (name_string (name_path (name_seg) @constant)))
(name_term object_name: (name_string (name_path (name_seg) @constant)))
(alias_term alias_object: (name_string (name_path (name_seg) @constant)))

; field terms
(field_unit_entry (name_seg) @property)
(create_bit_field_term bit_field_name: (name_string (name_path (name_seg) @property)))
(create_byte_field_term byte_field_name: (name_string (name_path (name_seg) @property)))
(create_word_field_term word_field_name: (name_string (name_path (name_seg) @property)))
(create_dword_field_term dword_field_name: (name_string (name_path (name_seg) @property)))
(create_qword_field_term qword_field_name: (name_string (name_path (name_seg) @property)))
(create_field_term field_name: (name_string (name_path (name_seg) @property)))
(pld_keyword) @property

; resource descriptor names
(_ descriptor_name: (name_string (name_path (name_seg) @label)))

; method call
(method_invocation_term (name_string (name_path (name_seg) @function)))

; keywords
[
  ; declarations
  (definition_block)
  (device)
  (method)
  (function)
  (scope)
  (name)
  (alias)
  (processor)
  (power_resource)
  (thermal_zone)
  (mutex)
  (event)
  (field)
  (bank_field)
  (index_field)
  (operation_region)
  (data_table_region)
  (offset)
  (access_as)
  (connection)
  (create_bit_field)
  (create_byte_field)
  (create_word_field)
  (create_dword_field)
  (create_qword_field)
  (create_field)

  ; control flow
  (if)
  (else)
  (else_if)
  (switch)
  (case)
  (default)
  (while)
  (for)
  (break)
  (break_point)
  (continue)
  (return)
  (fatal)
  (no_op)
  (sleep)
  (stall)
  (notify)
  (acquire)
  (release)
  (reset)
  (signal)
  (wait)
  (load)
  (load_table)
  (unload)
] @keyword

; compiler directives
[
  (include)
  (external)
] @preproc

; operator functions
[
  (add)
  (and)
  (decrement)
  (divide)
  (find_set_left_bit)
  (find_set_right_bit)
  (increment)
  (mod)
  (multiply)
  (n_and)
  (n_or)
  (not)
  (or)
  (shift_left)
  (shift_right)
  (subtract)
  (xor)
  (l_and)
  (l_equal)
  (l_greater)
  (l_greater_equal)
  (l_less)
  (l_less_equal)
  (l_not)
  (l_not_equal)
  (l_or)
  (cond_ref_of)
  (deref_of)
  (ref_of)
  (concatenate)
  (concatenate_res_template)
  (copy_object)
  (eisa_id)
  (fprintf)
  (printf)
  (from_bcd)
  (to_bcd)
  (index)
  (match)
  (mid)
  (object_type)
  (size_of)
  (store)
  (timer)
  (to_buffer)
  (to_decimal_string)
  (to_hex_string)
  (to_integer)
  (to_pld)
  (to_string)
  (to_uuid)
  (unicode)
] @function

; data constructors
[
  (buffer)
  (package)
  (raw_data_buffer)
  (resource_template)
  (dma)
  (dword_io)
  (dword_memory)
  (dword_space)
  (end_dependent_fn)
  (extended_io)
  (extended_memory)
  (extended_space)
  (fixed_dma)
  (fixed_io)
  (gpio_int)
  (gpio_io)
  (i2c_serial_bus_v2)
  (interrupt)
  (io)
  (irq)
  (irq_no_flags)
  (memory24)
  (memory32)
  (memory32_fixed)
  (pin_config)
  (pin_function)
  (pin_group)
  (pin_group_config)
  (pin_group_function)
  (qword_io)
  (qword_memory)
  (qword_space)
  (register)
  (spi_serial_bus_v2)
  (start_dependent_fn)
  (start_dependent_fn_no_pri)
  (uart_serial_bus_v2)
  (vendor_long)
  (vendor_short)
  (word_bus_number)
  (word_io)
  (word_space)
] @constructor

; builtin type
(object_type_keyword) @type.builtin

; builtin constants
[
  (zero)
  (one)
  (ones)
  (revision)
  (access_attrib_keyword)
  (access_type_keyword)
  (address_keyword)
  (addressing_mode_keyword)
  (bus_master_keyword)
  (clock_phase_keyword)
  (clock_polarity_keyword)
  (data_bits_keyword)
  (decode_keyword)
  (device_polarity_keyword)
  (dma_type_keyword)
  (endianess_keyword)
  (extended_access_attrib_keyword)
  (flow_control_keyword)
  (interrupt_type_keyword)
  (interrupt_level_keyword)
  (io_decode_keyword)
  (io_restriction_keyword)
  (lock_rule_keyword)
  (match_op_keyword)
  (max_keyword)
  (mem_type_keyword)
  (min_keyword)
  (parity_type_keyword)
  (pin_config_keyword)
  (range_type_keyword)
  (read_write_keyword)
  (region_space_keyword)
  (resource_type_keyword)
  (serialize_rule_keyword)
  (share_type_keyword)
  (slave_mode_keyword)
  (stop_bits_keyword)
  (transfer_width_keyword)
  (translation_keyword)
  (type_keyword)
  (update_rule_keyword)
  (wire_mode_keyword)
  (xfer_type_keyword)
] @constant.builtin

[
  "+" "/" "%" "*" "-" "<<" ">>" "&" "|"
  "^" "~" "++" "--" "==" "!=" "<" ">" "<="
  ">=" "&&" "||" "!" "=" "+=" "/=" "%="
  "*=" "-=" "<<=" ">>=" "&=" "|=" "^="
] @operator
[ "(" ")" "{" "}" "[" "]" ] @punctuation.bracket
[ "," "." ";" ] @punctuation.delimiter
[ "\\" "^" ] @punctuation.special


; https://neovim.io/doc/user/treesitter/
