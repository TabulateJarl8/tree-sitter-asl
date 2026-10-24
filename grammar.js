/**
 * @file ACPI Source Language
 * @author Connor Sample <tabulatejarl8@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// NOTE: anything ending in _list must be wrapped in optional() in the parent caller

/**
 * Comma separated list of 1 or more entries
 * @param {Rule} rule
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(",", rule)));
}

/**
 * Check if a given treesitter rule is optional
 * @param {Rule} rule
 * @returns
 */
function isOptional(rule) {
  // optional() returns a ChoiceRule where one of the options is BlankRule
  // https://github.com/tree-sitter/tree-sitter/blob/0fff6ab6ed206903856200e5390c5dad22924948/crates/generate/src/dsl.js#L60
  return (
    rule &&
    rule.type === "CHOICE" &&
    rule.members.some((m) => m.type === "BLANK")
  );
}

/**
 * @type {Record<string, () => SeqRule>}
 */
const termHelperRules = {};

/**
 *
 * @param {Rule & {name: string}} keyword named rule
 * @param {Record<string, Rule>} args
 * @param {Record<string, Rule>?} block
 * @returns {Rule}
 */
function makeTerm(keyword, args = {}, block = null) {
  const parts = [];
  const entries = Object.entries(args);

  // any optional rules need to be split into their own subrule so that we don't get state explosion
  // its sort of vaguely talked about here https://github.com/tree-sitter/tree-sitter/wiki/Tips-and-Tricks-for-a-grammar-author

  // in ASL, optional args in the middle require commas and are omitted, and trailing optionals can be omitted

  // find where trailing optionals start (they'll be chained together at the end to allow for up to x number of omissions)
  let trailingOptionalStartIndex = entries.length;
  while (
    trailingOptionalStartIndex > 1 &&
    isOptional(entries[trailingOptionalStartIndex - 1][1])
  )
    trailingOptionalStartIndex--;

  // transform everything up to trailing optionals into grammar
  for (let i = 0; i < trailingOptionalStartIndex; i++) {
    const [key, rule] = entries[i];
    const fielded = field(key, rule);

    if (i === 0) {
      parts.push(fielded);
    } else if (isOptional(rule)) {
      // optionals are pushed into their own hidden rule
      const ruleName = `__${keyword.name}_${key}`;
      termHelperRules[ruleName] = () => seq(",", fielded);
      parts.push(sym(ruleName));
    } else {
      parts.push(",", fielded);
    }
  }

  // optional trailing args are allowed to be left out, chain them together like a linked list
  if (trailingOptionalStartIndex < entries.length) {
    for (let i = entries.length - 1; i >= trailingOptionalStartIndex; i--) {
      const [key, rule] = entries[i];
      const ruleName = `__${keyword.name}_${key}`;
      const nextRule = (() => {
        if (i + 1 < entries.length) {
          return [optional(sym(`__${keyword.name}_${entries[i + 1][0]}`))];
        } else {
          return [];
        }
      })();

      termHelperRules[ruleName] = () => seq(",", field(key, rule), ...nextRule);
    }

    // push start of rule chain to the end of parts
    parts.push(
      optional(
        sym(`__${keyword.name}_${entries[trailingOptionalStartIndex][0]}`),
      ),
    );
  }

  const parens = seq(keyword, "(", ...parts, ")");
  if (!block) return parens;

  const blockFields = Object.entries(block).map(([key, rule]) =>
    field(key, rule),
  );
  return seq(parens, "{", ...blockFields, "}");
}

/**
 * Wrapper function to provide treesitter autocomplete for the grammar record.
 * @template {string} T
 * @param {Grammar<T>} g
 * @returns {Grammar<T>}
 */
const defineGrammar = (g) => g;

const grammarMap = defineGrammar({
  name: "asl",

  extras: ($) => [/\s/, $.comment],

  conflicts: ($) => [
    // these both parse symbolic_expression_term so we need to look further ahead to differentiate
    [$.expression_opcode, $.integer_type_opcode],
    // both match expression_opcode
    [$.term, $.term_arg],
    // both match concat_res_term
    [$.expression_opcode, $.buffer_type_opcode],
    // all match concat_term
    [$.expression_opcode, $.string_type_opcode, $.buffer_type_opcode],
    // all match deref_of_term
    [
      $.expression_opcode,
      $.integer_type_opcode,
      $.string_type_opcode,
      $.buffer_type_opcode,
    ],
    // both match fprintf_term
    [$.expression_opcode, $.string_type_opcode],
    // multiple parent prefix ambiguity
    [$.name_string],
    // standalone name vs function call
    [$.term_arg, $.method_invocation_term],
    // ambiguity when integer or const is passed as pkg length
    [$._byte_const_expr, $.integer_data],
    [$._byte_const_expr, $.const_term],
    // ambiguous opcode returns
    [$.integer_type_opcode, $.string_type_opcode],
    [$.buffer_type_opcode, $.string_type_opcode],
    [$.buffer_type_opcode, $.integer_type_opcode, $.string_type_opcode],
  ],

  inline: ($) => [
    $.word_const,
    $.byte_const,
    $.dword_const,
    $.qword_const,
    $.true,
    $.false,
    $.continue_term,
    $.debug_term,
    $.no_op_term,
    $.timer_term,
    $.user_def_region_space,
  ],

  rules: {
    source_file: ($) => optional($.asl_code),

    comment: (_) =>
      token(
        choice(seq("//", /[^\n]*/), seq("/*", /[^*]*\*+([^/*][^*]*\*+)*/, "/")),
      ),

    // 19.2.2 ASL Name and Pathname Terms
    _root_char: (_) => "\\",
    _parent_prefix_char: (_) => "^",
    _parent_prefix_list: ($) => repeat1($._parent_prefix_char),
    _path_separator_char: (_) => ".",
    // NOTE: this differs from the spec slightly to avoid empty string matching
    name_string: ($) =>
      choice(
        seq($._root_char, optional($.name_path)),
        seq($._parent_prefix_list, optional($.name_path)),
        $.name_path,
      ),
    // NOTE: this differs from the spec slightly to avoid empty string matching
    name_path: ($) =>
      seq($.name_seg, repeat(seq($._path_separator_char, $.name_seg))),

    // 19.2.3 ASL Root and Secondary Terms
    // Root Terms
    asl_code: ($) => $.definition_block_list,
    definition_block_list: ($) => repeat1($.definition_block_term),
    // Major Terms
    super_name: ($) =>
      choice(
        $.name_string,
        $.arg_term,
        $.local_term,
        $.debug_term,
        $.reference_type_opcode,
        $.method_invocation_term,
      ),
    // NOTE: WHEN TARGET IS USED IT MUST BE OPTIONAL
    // we can't make it optional here since it would violate the empty string match rule
    target: ($) => $.super_name,
    term_arg: ($) =>
      choice(
        $.expression_opcode,
        $.data_object,
        $.arg_term,
        $.local_term,
        $.name_string,
      ),
    method_invocation_term: ($) =>
      seq($.name_string, "(", optional($.arg_list), ")"),

    // List Terms
    // NOTE: these must all be wrapped in optional() in their parents
    arg_list: ($) => commaSep1($.term_arg),
    byte_list: ($) => commaSep1($._byte_const_expr),
    dword_list: ($) => commaSep1($._dword_const_expr),

    extended_access_attrib_term: ($) =>
      seq(
        $.extended_access_attrib_keyword,
        "(",
        field("access_length", $.byte_const),
        ")",
      ),

    //NOTE: this must be wrapped in optional() in the parent
    field_unit_list: ($) => commaSep1($.field_unit),
    field_unit: ($) =>
      choice(
        $.field_unit_entry,
        $.offset_term,
        $.access_as_term,
        $.connection_term,
      ),
    field_unit_entry: ($) => seq(optional($.name_seg), ",", $.integer),

    // NOTE: this must be wrapped in optional() in the parent
    package_list: ($) => commaSep1($.package_element),
    package_element: ($) => choice($.data_object, $.name_string),

    parameter_type_package: ($) =>
      choice(
        $.object_type_keyword,
        seq("{", optional($.parameter_type_package_list), "}"),
      ),
    parameter_type_package_list: ($) => commaSep1($.object_type_keyword),

    parameter_types_package: ($) =>
      choice(
        $.object_type_keyword,
        seq("{", optional($.parameter_types_package_list), "}"),
      ),
    parameter_types_package_list: ($) => commaSep1($.parameter_type_package),
    // NOTE: this must be marked optional() in the parent
    term_list: ($) => repeat1(seq($.term, optional(";"))),
    term: ($) => choice($.object, $.statement_opcode, $.expression_opcode),
    object: ($) =>
      choice($.compiler_directive, $.named_object, $.name_space_modifier),

    // Conditional Execution List Terms
    // NOTE: this differs from the spec slightly to avoid empty string matches
    // NOTE: this must be marked optional() in the parent
    case_term_list: ($) => repeat1(choice($.case_term, $.default_term)),
    if_else_term: ($) => seq($.if_term, optional($._else_else_if)),

    // 19.2.4 ASL Data and Constant Terms
    // Numeric Value Terms
    // _lead_digit_char: (_) => /[1-9]/,
    // _hex_digit_char: (_) => /[0-9A-Fa-f]/,
    // _octal_digit_char: (_) => /[0-7]/,
    _null_char: (_) => token("\0"),

    // Data Terms
    buffer_data: ($) => choice($.buffer_type_opcode, $.buffer_term),
    computational_data: ($) =>
      choice($.buffer_data, $.integer_data, $.string_data),
    data_object: ($) =>
      choice($.buffer_data, $.package_data, $.integer_data, $.string_data),
    data_ref_object: ($) => choice($.data_object, $.object_reference),
    integer_data: ($) => choice($.integer_type_opcode, $.integer, $.const_term),
    package_data: ($) => $.package_term,
    string_data: ($) => choice($.string_type_opcode, $.string),

    // Integer Terms
    integer: ($) => choice($.decimal_const, $.octal_const, $.hex_const),
    decimal_const: (_) => /[1-9][0-9]*/,
    octal_const: (_) => /0[0-7]*/,
    hex_const: (_) => /0[xX][0-9A-Fa-f]+/,

    byte_const: ($) => $.integer,
    word_const: ($) => $.integer,
    dword_const: ($) => $.integer,
    qword_const: ($) => $.integer,

    _byte_const_expr: ($) =>
      choice($.integer_type_opcode, $.const_expr_term, $.integer),
    _word_const_expr: ($) =>
      choice($.integer_type_opcode, $.const_expr_term, $.integer),
    _dword_const_expr: ($) =>
      choice($.integer_type_opcode, $.const_expr_term, $.integer),
    _qword_const_expr: ($) =>
      choice($.integer_type_opcode, $.const_expr_term, $.integer),

    const_term: ($) => choice($.const_expr_term, $.revision),
    const_expr_term: ($) => choice($.zero, $.one, $.ones),

    // String Terms
    string: ($) => seq('"', optional($._utf8_char_list), '"'),
    _utf8_char_list: ($) => repeat1(choice($._escape_sequence, $._utf8_char)),
    _utf8_char: (_) => /[^"\\\x00]+/,

    // Eescape sequences
    _escape_sequence: ($) =>
      choice(
        $._simple_escape_sequence,
        $._octal_escape_sequence,
        $._hex_escape_sequence,
      ),
    _simple_escape_sequence: (_) => /\\['"abfnrtv\\]/,
    _hex_escape_sequence: (_) => /\\x[0-9A-Fa-f]{1,2}/,
    _octal_escape_sequence: (_) => /\\[0-7]{1,3}/,

    // Misc Data Type Terms
    object_reference: ($) => $.integer,
    boolean: ($) => choice($.true, $.false),
    true: ($) => $.ones,
    false: ($) => $.zero,

    // Symbolic Operator terms
    operators: (_) =>
      choice("+", "-", "*", "/", "%", "&", "|", "^", "~", "<", ">", "!", "="),
    compound_operators: (_) =>
      choice(
        "<<",
        ">>",
        "++",
        "--", // this is '-' in the spec and i think thats wrong
        "==",
        "!=",
        "<=",
        ">=",
        "&&",
        "||",
        "+=",
        "-=",
        "*=",
        "/=",
        "%=",
        "<<=",
        ">>=",
        "&=",
        "|=",
        "^=",
      ),

    // 19.2.5 ASL Opcode Terms
    compiler_directive: ($) => choice($.include_term, $.external_term),
    named_object: ($) =>
      choice(
        $.bank_field_term,
        $.create_bit_field_term,
        $.create_byte_field_term,
        $.create_dword_field_term,
        $.create_field_term,
        $.create_qword_field_term,
        $.create_word_field_term,
        $.data_region_term,
        $.device_term,
        $.event_term,
        $.field_term,
        $.function_term,
        $.index_field_term,
        $.method_term,
        $.mutex_term,
        $.op_region_term,
        $.power_res_term,
        $.processor_term,
        $.thermal_zone_term,
      ),
    name_space_modifier: ($) => choice($.alias_term, $.name_term, $.scope_term),
    symbolic_expression_term: ($) =>
      choice(
        seq("(", $.term_arg, ")"),
        $.add_symbolic_term,
        $.and_symbolic_term,
        $.dec_symbolic_term,
        $.divide_symbolic_term,
        $.inc_symbolic_term,
        $.l_and_symbolic_term,
        $.l_equal_symbolic_term,
        $.l_greater_equal_symbolic_term,
        $.l_greater_symbolic_term,
        $.l_less_equal_symbolic_term,
        $.l_less_symbolic_term,
        $.l_not_equal_symbolic_term,
        $.l_not_symbolic_term,
        $.l_or_symbolic_term,
        $.mod_symbolic_term,
        $.multiply_symbolic_term,
        $.not_symbolic_term,
        $.or_symbolic_term,
        $.shift_left_symbolic_term,
        $.shift_right_symbolic_term,
        $.subtract_symbolic_term,
        $.xor_symbolic_term,
      ),

    symbolic_assignment_term: ($) =>
      choice(
        $.store_symbolic_term,
        $.add_compound_term,
        $.and_compound_term,
        $.divide_compound_term,
        $.mod_compound_term,
        $.multiply_compound_term,
        $.or_compound_term,
        $.shift_left_compound_term,
        $.shift_right_compound_term,
        $.subtract_compound_term,
        $.xor_compound_term,
      ),

    statement_opcode: ($) =>
      choice(
        $.break_term,
        $.break_point_term,
        $.continue_term,
        $.fatal_term,
        $.for_term,
        $.if_else_term,
        $.no_op_term,
        $.notify_term,
        $.release_term,
        $.reset_term,
        $.return_term,
        $.signal_term,
        $.sleep_term,
        $.stall_term,
        $.switch_term,
        $.unload_term,
        $.while_term,
      ),

    expression_opcode: ($) =>
      choice(
        $.acquire_term,
        $.add_term,
        $.and_term,
        $.concat_term,
        $.concat_res_term,
        $.cond_ref_of_term,
        $.copy_object_term,
        $.dec_term,
        $.deref_of_term,
        $.divide_term,
        $.find_set_left_bit_term,
        $.find_set_right_bit_term,
        $.fprintf_term,
        $.from_bcd_term,
        $.inc_term,
        $.index_term,
        $.l_and_term,
        $.l_equal_term,
        $.l_greater_term,
        $.l_greater_equal_term,
        $.l_less_term,
        $.l_less_equal_term,
        $.l_not_term,
        $.l_not_equal_term,
        $.l_or_term,
        $.match_term,
        $.mid_term,
        $.mod_term,
        $.multiply_term,
        $.n_and_term,
        $.n_or_term,
        $.not_term,
        $.object_type_term,
        $.or_term,
        $.printf_term,
        $.ref_of_term,
        $.shift_left_term,
        $.shift_right_term,
        $.size_of_term,
        $.store_term,
        $.subtract_term,
        $.timer_term,
        $.to_bcd_term,
        $.to_buffer_term,
        $.to_decimal_string_term,
        $.to_hex_string_term,
        $.to_integer_term,
        $.to_string_term,
        $.wait_term,
        $.xor_term,
        $.method_invocation_term,
        $.symbolic_expression_term,
        $.symbolic_assignment_term,
      ),

    integer_type_opcode: ($) =>
      choice(
        $.add_term,
        $.and_term,
        $.dec_term,
        $.deref_of_term,
        $.divide_term,
        $.eisa_id_term,
        $.find_set_left_bit_term,
        $.find_set_right_bit_term,
        $.from_bcd_term,
        $.inc_term,
        $.l_and_term,
        $.l_equal_term,
        $.l_greater_term,
        $.l_greater_equal_term,
        $.l_less_term,
        $.l_less_equal_term,
        $.l_not_term,
        $.l_not_equal_term,
        $.match_term,
        $.mod_term,
        $.multiply_term,
        $.n_and_term,
        $.n_or_term,
        $.not_term,
        $.or_term,
        $.shift_left_term,
        $.shift_right_term,
        $.subtract_term,
        $.to_bcd_term,
        $.to_integer_term,
        $.xor_term,
        $.symbolic_expression_term,
      ),

    string_type_opcode: ($) =>
      choice(
        $.concat_term,
        $.deref_of_term,
        $.fprintf_term,
        $.mid_term,
        $.printf_term,
        $.to_decimal_string_term,
        $.to_hex_string_term,
        $.to_string_term,
      ),

    buffer_type_opcode: ($) =>
      choice(
        $.concat_term,
        $.concat_res_term,
        $.deref_of_term,
        $.mid_term,
        $.resource_template_term,
        $.to_buffer_term,
        $.to_pld_term,
        $.to_uuid_term,
        $.unicode_term,
      ),

    reference_type_opcode: ($) =>
      choice(
        $.ref_of_term,
        $.deref_of_term,
        $.index_term,
        $.index_symbolic_term,
        // TODO: find the def for this
        //$.user_term_obj,
      ),

    // 19.2.6 ASL Primary (Terminal) Terms
    _access_attribute: ($) =>
      choice(
        $._byte_const_expr,
        $.access_attrib_keyword,
        $.extended_access_attrib_term,
      ),
    access_as_term: ($) =>
      seq(
        $.access_as,
        "(",
        field("access_type", $.access_type_keyword),
        optional(seq(",", field("access_attribute", $._access_attribute))),
        ")",
      ),

    acquire_term: ($) =>
      makeTerm($.acquire, {
        sync_object: $.super_name,
        timeout_value: $._word_const_expr,
      }),

    add_compound_term: ($) =>
      prec.right(
        seq(
          field("addend1_result", $.term_arg),
          "+=",
          field("addend2", $.term_arg),
        ),
      ),

    add_symbolic_term: ($) =>
      prec.left(
        seq(field("addend1", $.term_arg), "+", field("addend2", $.term_arg)),
      ),

    add_term: ($) =>
      makeTerm($.add, {
        addend1: $.term_arg,
        addend2: $.term_arg,
        result: optional($.target),
      }),

    alias_term: ($) =>
      makeTerm($.alias, {
        source_object: $.name_string,
        alias_object: $.name_string,
      }),

    and_compound_term: ($) =>
      prec.right(
        seq(
          field("source1_result", $.term_arg),
          "&=",
          field("source2", $.term_arg),
        ),
      ),

    and_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "&", field("source2", $.term_arg)),
      ),

    and_term: ($) =>
      makeTerm($.and, {
        source1: $.term_arg,
        source2: $.term_arg,
        result: optional($.target),
      }),

    arg_term: (_) => /Arg[0-6]/i,

    bank_field_term: ($) =>
      makeTerm(
        $.bank_field,
        {
          region_name: $.name_string,
          bank_name: $.name_string,
          bank_value: $.term_arg,
          access_type: $.access_type_keyword,
          lock_rule: $.lock_rule_keyword,
          update_rule: $.update_rule_keyword,
        },
        { field_unit_list: optional($.field_unit_list) },
      ),

    break_point_term: ($) => $.break_point,
    break_term: ($) => $.break,

    buffer_term: ($) =>
      makeTerm(
        $.buffer,
        { buff_size: optional($.term_arg) },
        { block: choice($.string_data, optional($.byte_list)) },
      ),

    case_term: ($) =>
      makeTerm($.case, {
        value: $.data_object,
        term_list: optional($.term_list),
      }),

    concat_res_term: ($) =>
      makeTerm($.concatenate_res_template, {
        source1: $.term_arg,
        source2: $.term_arg,
        result: optional($.target),
      }),

    concat_term: ($) =>
      makeTerm($.concatenate, {
        source1: $.term_arg,
        source2: $.term_arg,
        result: optional($.target),
      }),

    connection_term: ($) =>
      makeTerm($.connection, {
        connection_resource: choice($.name_string, $.resource_macro_term),
      }),

    cond_ref_of_term: ($) =>
      makeTerm(
        $.cond_ref_of,
        {
          source: choice(
            $.name_string,
            $.arg_term,
            $.local_term,
            $.deref_of_term,
          ),
        },
        { destination: optional($.target) },
      ),

    continue_term: ($) => $.continue,

    copy_object_term: ($) =>
      makeTerm($.copy_object, {
        source: $.term_arg,
        result: choice($.name_string, $.local_term, $.arg_term),
      }),

    create_bit_field_term: ($) =>
      makeTerm($.create_bit_field, {
        source_buffer: $.term_arg,
        bit_index: $.term_arg,
        bit_field_name: $.name_string,
      }),
    create_byte_field_term: ($) =>
      makeTerm($.create_byte_field, {
        source_buffer: $.term_arg,
        byte_index: $.term_arg,
        byte_field_name: $.name_string,
      }),
    create_dword_field_term: ($) =>
      makeTerm($.create_dword_field, {
        source_buffer: $.term_arg,
        byte_index: $.term_arg,
        dword_field_name: $.name_string,
      }),
    create_qword_field_term: ($) =>
      makeTerm($.create_qword_field, {
        source_buffer: $.term_arg,
        byte_index: $.term_arg,
        qword_field_name: $.name_string,
      }),
    create_word_field_term: ($) =>
      makeTerm($.create_word_field, {
        source_buffer: $.term_arg,
        byte_index: $.term_arg,
        word_field_name: $.name_string,
      }),
    create_field_term: ($) =>
      makeTerm($.create_field, {
        source_buffer: $.term_arg,
        bit_index: $.term_arg,
        num_bits: $.term_arg,
        field_name: $.name_string,
      }),

    data_region_term: ($) =>
      makeTerm($.data_table_region, {
        region_name: $.name_string,
        signature_string: $.term_arg,
        oem_id_string: $.term_arg,
        oem_table_id_string: $.term_arg,
      }),

    debug_term: ($) => $.debug,

    dec_symbolic_term: ($) => seq(field("minuend", $.super_name), "--"),

    dec_term: ($) => makeTerm($.decrement, { minuend: $.super_name }),

    default_term: ($) => seq($.default, "{", optional($.term_list), "}"),

    definition_block_term: ($) =>
      makeTerm(
        $.definition_block,
        {
          aml_file_name: $.string,
          table_signature: $.string,
          compliance_revision: $.byte_const,
          oem_id: $.string,
          table_id: $.string,
          oem_revision: $.dword_const,
        },
        { term_list: optional($.term_list) },
      ),

    _deref_of_source: ($) =>
      choice(
        $.name_string,
        $.arg_term,
        $.local_term,
        $.ref_of_term,
        $.cond_ref_of_term,
        $.index_term,
        $.method_invocation_term,
        // the spec doesn't explicitly allow for these, but my laptop's ASL uses these in DerefOfs
        $.index_symbolic_term,
        $.deref_of_term,
      ),
    deref_of_term: ($) => makeTerm($.deref_of, { source: $._deref_of_source }),

    device_term: ($) =>
      makeTerm(
        $.device,
        { device_name: $.name_string },
        { term_list: optional($.term_list) },
      ),

    divide_compound_term: ($) =>
      prec.right(
        seq(
          field("dividend_result", $.term_arg),
          "/=",
          field("divisor", $.term_arg),
        ),
      ),

    divide_symbolic_term: ($) =>
      prec.left(
        seq(field("dividend", $.term_arg), "/", field("divisor", $.term_arg)),
      ),

    divide_term: ($) =>
      makeTerm($.divide, {
        dividend: $.term_arg,
        divisor: $.term_arg,
        remainder: optional($.target),
        result: optional($.target),
      }),

    eisa_id_term: ($) => makeTerm($.eisa_id, { eisa_id_string: $.string_data }),

    _else_else_if: ($) => choice($.else_term, $.else_if_term),

    else_if_term: ($) =>
      seq(
        makeTerm(
          $.else_if,
          { predicate: $.term_arg },
          { term_list: optional($.term_list) },
        ),
        optional($._else_else_if),
      ),

    // WARN: this deviates from the spec a little because ebnf is weird
    // NOTE: optionality should be handled in the parent rule
    else_term: ($) =>
      seq($.else, "{", field("term_list", optional($.term_list)), "}"),

    event_term: ($) => makeTerm($.event, { event_name: $.name_string }),

    external_term: ($) =>
      makeTerm($.external, {
        obj_name: $.name_string,
        obj_type: optional($.object_type_keyword),
        result_type: optional($.parameter_type_package),
        parameter_types: optional($.parameter_types_package),
      }),

    fatal_term: ($) =>
      makeTerm($.fatal, {
        type: $._byte_const_expr,
        code: $._dword_const_expr,
        arg: $.term_arg,
      }),

    field_term: ($) =>
      makeTerm(
        $.field,
        {
          region_name: $.name_string,
          access_type: $.access_type_keyword,
          lock_rule: $.lock_rule_keyword,
          update_rule: $.update_rule_keyword,
        },
        { field_unit_list: optional($.field_unit_list) },
      ),

    find_set_left_bit_term: ($) =>
      makeTerm($.find_set_left_bit, {
        source: $.term_arg,
        result: optional($.target),
      }),
    find_set_right_bit_term: ($) =>
      makeTerm($.find_set_right_bit, {
        source: $.term_arg,
        result: optional($.target),
      }),

    for_term: ($) =>
      makeTerm(
        $.for,
        {
          initialize: optional($.term_arg),
          predicate: optional($.term_arg),
          update: optional($.term_arg),
        },
        { term_list: optional($.term_list) },
      ),

    fprintf_term: ($) =>
      makeTerm($.fprintf, {
        term_arg: $.term_arg,
        string: $.string,
        printf_arg_list: $.printf_arg_list,
      }),

    from_bcd_term: ($) =>
      makeTerm($.from_bcd, {
        bcd_value: $.term_arg,
        result: optional($.target),
      }),

    function_term: ($) =>
      makeTerm(
        $.function,
        {
          function_name: $.name_string,
          return_type: optional($.parameter_type_package),
          parameter_types: optional($.parameter_types_package),
        },
        { term_list: optional($.term_list) },
      ),

    if_term: ($) =>
      makeTerm(
        $.if,
        { predicate: $.term_arg },
        { term_list: optional($.term_list) },
      ),

    include_term: ($) => makeTerm($.include, { file_path_name: $.string_data }),

    inc_symbolic_term: ($) => seq(field("addend", $.super_name), "++"),

    inc_term: ($) => makeTerm($.increment, { addend: $.super_name }),

    index_field_term: ($) =>
      makeTerm(
        $.index_field,
        {
          index_name: $.name_string,
          data_name: $.name_string,
          access_type: $.access_type_keyword,
          lock_rule: $.lock_rule_keyword,
          update_rule: $.update_rule_keyword,
        },
        { field_unit_list: optional($.field_unit_list) },
      ),

    index_symbolic_term: ($) =>
      seq(field("source", $.term_arg), "[", field("index", $.term_arg), "]"),

    index_term: ($) =>
      makeTerm($.index, {
        source: $.term_arg,
        index: $.term_arg,
        destination: optional($.target),
      }),

    l_and_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "&&", field("source2", $.term_arg)),
      ),

    l_and_term: ($) =>
      makeTerm($.l_and, {
        source1: $.term_arg,
        source2: $.term_arg,
      }),

    l_equal_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "==", field("source2", $.term_arg)),
      ),

    l_equal_term: ($) =>
      makeTerm($.l_equal, {
        source1: $.term_arg,
        source2: $.term_arg,
      }),

    l_greater_equal_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), ">=", field("source2", $.term_arg)),
      ),

    l_greater_equal_term: ($) =>
      makeTerm($.l_greater_equal, {
        source1: $.term_arg,
        source2: $.term_arg,
      }),

    l_greater_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), ">", field("source2", $.term_arg)),
      ),

    l_greater_term: ($) =>
      makeTerm($.l_greater, {
        source1: $.term_arg,
        source2: $.term_arg,
      }),

    l_less_equal_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "<=", field("source2", $.term_arg)),
      ),

    l_less_equal_term: ($) =>
      makeTerm($.l_less_equal, {
        source1: $.term_arg,
        source2: $.term_arg,
      }),

    l_less_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "<", field("source2", $.term_arg)),
      ),

    l_less_term: ($) =>
      makeTerm($.l_less, {
        source1: $.term_arg,
        source2: $.term_arg,
      }),

    l_not_equal_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "!=", field("source2", $.term_arg)),
      ),

    l_not_equal_term: ($) =>
      makeTerm($.l_not_equal, {
        source1: $.term_arg,
        source2: $.term_arg,
      }),

    l_not_symbolic_term: ($) => prec(1, seq("!", field("source", $.term_arg))),

    l_not_term: ($) => makeTerm($.l_not, { source: $.term_arg }),

    l_or_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "||", field("source2", $.term_arg)),
      ),

    l_or_term: ($) =>
      makeTerm($.l_or, {
        source1: $.term_arg,
        source2: $.term_arg,
      }),

    load_table_term: ($) =>
      makeTerm($.load_table, {
        signature_string: $.term_arg,
        oem_id_string: $.term_arg,
        oem_table_id_string: $.term_arg,
        root_path_string: optional($.term_arg),
        parameter_path_string: optional($.term_arg),
        parameter_data: optional($.term_arg),
      }),

    load_term: ($) =>
      makeTerm($.load, {
        object: $.name_string,
        result: $.super_name,
      }),

    local_term: (_) => /Local[0-7]/i,

    match_term: ($) =>
      makeTerm($.match, {
        search_package: $.term_arg,
        op1: $.match_op_keyword,
        match_object_1: $.term_arg,
        op2: $.match_op_keyword,
        match_object_2: $.term_arg,
        start_index: $.term_arg,
      }),

    method_term: ($) =>
      makeTerm(
        $.method,
        {
          method_name: $.name_string,
          num_args: optional($._byte_const_expr),
          serialize_rule: optional($.serialize_rule_keyword),
          sync_level: optional($._byte_const_expr),
          return_type: optional($.parameter_type_package),
          parameter_types: optional($.parameter_types_package),
        },
        { term_list: optional($.term_list) },
      ),

    mid_term: ($) =>
      makeTerm($.mid, {
        source: $.term_arg,
        index: $.term_arg,
        length: $.term_arg,
        result: optional($.target),
      }),

    mod_compound_term: ($) =>
      prec.right(
        seq(
          field("dividend_result", $.term_arg),
          "%=",
          field("divisor", $.term_arg),
        ),
      ),

    mod_symbolic_term: ($) =>
      prec.left(
        seq(field("dividend", $.term_arg), "%", field("divisor", $.term_arg)),
      ),

    mod_term: ($) =>
      makeTerm($.mod, {
        dividend: $.term_arg,
        divisor: $.term_arg,
        result: optional($.target),
      }),

    multiply_compound_term: ($) =>
      prec.right(
        seq(
          field("multiplicand_result", $.term_arg),
          "*=",
          field("multiplier", $.term_arg),
        ),
      ),

    multiply_symbolic_term: ($) =>
      prec.left(
        seq(
          field("multiplicand", $.term_arg),
          "*",
          field("multiplier", $.term_arg),
        ),
      ),

    multiply_term: ($) =>
      makeTerm($.multiply, {
        multiplicand: $.term_arg,
        multiplier: $.term_arg,
        result: optional($.target),
      }),

    mutex_term: ($) =>
      makeTerm($.mutex, {
        mutex_name: $.name_string,
        sync_level: $._byte_const_expr,
      }),

    name_term: ($) =>
      makeTerm($.name, {
        object_name: $.name_string,
        object: $.data_object,
      }),

    n_and_term: ($) =>
      makeTerm($.n_and, {
        source1: $.term_arg,
        source2: $.term_arg,
        result: optional($.target),
      }),

    no_op_term: ($) => $.no_op,

    n_or_term: ($) =>
      makeTerm($.n_or, {
        source1: $.term_arg,
        source2: $.term_arg,
        result: optional($.target),
      }),

    notify_term: ($) =>
      makeTerm($.notify, {
        object: $.super_name,
        notification_value: $.term_arg,
      }),

    not_symbolic_term: ($) => prec(1, seq("~", field("source", $.term_arg))),

    not_term: ($) =>
      makeTerm($.not, {
        source: $.term_arg,
        result: optional($.target),
      }),

    object_type_term: ($) =>
      makeTerm($.object_type, {
        object: choice(
          $.name_string,
          $.arg_term,
          $.local_term,
          $.debug_term,
          $.ref_of_term,
          $.deref_of_term,
          $.index_term,
        ),
      }),

    offset_term: ($) => makeTerm($.offset, { byte_offset: $.integer_data }),

    op_region_term: ($) =>
      makeTerm($.operation_region, {
        region_name: $.name_string,
        region_space: $.region_space_keyword,
        offset: $.term_arg,
        length: $.term_arg,
      }),

    or_compound_term: ($) =>
      prec.right(
        seq(
          field("source1_result", $.term_arg),
          "|=",
          field("source2", $.term_arg),
        ),
      ),

    or_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "|", field("source2", $.term_arg)),
      ),

    or_term: ($) =>
      makeTerm($.or, {
        source1: $.term_arg,
        source2: $.term_arg,
        result: optional($.target),
      }),

    package_term: ($) =>
      makeTerm(
        $.package,
        { num_elements: optional(choice($._byte_const_expr, $.term_arg)) },
        { package_list: optional($.package_list) },
      ),

    pld_keyword: (_) =>
      choice(
        "PLD_Revision",
        "PLD_IgnoreColor",
        "PLD_Red",
        "PLD_Green",
        "PLD_Blue",
        "PLD_Width",
        "PLD_Height",
        "PLD_UserVisible",
        "PLD_Dock",
        "PLD_Lid",
        "PLD_Panel",
        "PLD_VerticalPosition",
        "PLD_HorizontalPosition",
        "PLD_Shape",
        "PLD_GroupOrientation",
        "PLD_GroupToken",
        "PLD_GroupPosition",
        "PLD_Bay",
        "PLD_Ejectable",
        "PLD_EjectRequired",
        "PLD_CabinetNumber",
      ),

    // WARN: this is terribly broken in the spec so this is my best guess of what they meant.
    // pld_keyword_assign isn't actually real, but it makes the AST a bit more readable
    pld_keyword_assign: ($) =>
      seq(
        field("keyword", $.pld_keyword),
        "=",
        field("value", choice($.string_data, $.integer_data)),
      ),
    pld_keyword_list: ($) =>
      seq($.pld_keyword_assign, repeat(seq(",", $.pld_keyword_assign))),

    power_res_term: ($) =>
      makeTerm(
        $.power_resource,
        {
          resource_name: $.name_string,
          system_level: $._byte_const_expr,
          resource_order: $._word_const_expr,
        },
        { term_list: optional($.term_list) },
      ),

    printf_arg_list: ($) => seq($.term_arg, repeat(seq(",", $.term_arg))),

    printf_term: ($) =>
      makeTerm($.printf, {
        string: $.string,
        printf_arg_list: $.printf_arg_list,
      }),

    processor_term: ($) =>
      makeTerm(
        $.processor,
        {
          processor_name: $.name_string,
          processor_id: $._byte_const_expr,
          pblock_address: optional($._dword_const_expr),
          pblock_length: optional($._byte_const_expr),
        },
        { term_list: optional($.term_list) },
      ),

    raw_data_buffer_term: ($) =>
      makeTerm(
        $.raw_data_buffer,
        { buff_size: optional($.word_const) },
        { byte_list: optional($.byte_list) },
      ),

    ref_of_term: ($) =>
      makeTerm($.ref_of, {
        source: choice(
          $.name_string,
          $.arg_term,
          $.local_term,
          $.deref_of_term,
        ),
      }),

    release_term: ($) => makeTerm($.release, { sync_object: $.super_name }),

    reset_term: ($) => makeTerm($.reset, { sync_object: $.super_name }),

    resource_template_term: ($) =>
      makeTerm(
        $.resource_template,
        {},
        { resource_macro_list: optional($.resource_macro_list) },
      ),

    return_term: ($) => makeTerm($.return, { arg: optional($.term_arg) }),

    scope_term: ($) =>
      makeTerm(
        $.scope,
        { location: $.name_string },
        { term_list: optional($.term_list) },
      ),

    shift_left_compound_term: ($) =>
      prec.right(
        seq(
          field("source_result", $.term_arg),
          "<<=",
          field("shift_count", $.term_arg),
        ),
      ),

    shift_left_symbolic_term: ($) =>
      prec.left(
        seq(
          field("source", $.term_arg),
          "<<",
          field("shift_count", $.term_arg),
        ),
      ),

    shift_left_term: ($) =>
      makeTerm($.shift_left, {
        source: $.term_arg,
        shift_count: $.term_arg,
        result: optional($.target),
      }),

    shift_right_compound_term: ($) =>
      prec.right(
        seq(
          field("source_result", $.term_arg),
          ">>=",
          field("shift_count", $.term_arg),
        ),
      ),

    shift_right_symbolic_term: ($) =>
      prec.left(
        seq(
          field("source", $.term_arg),
          ">>",
          field("shift_count", $.term_arg),
        ),
      ),

    shift_right_term: ($) =>
      makeTerm($.shift_right, {
        source: $.term_arg,
        shift_count: $.term_arg,
        result: optional($.target),
      }),

    signal_term: ($) => makeTerm($.signal, { sync_object: $.super_name }),

    size_of_term: ($) => makeTerm($.size_of, { data_object: $.super_name }),

    sleep_term: ($) => makeTerm($.sleep, { milliseconds: $.term_arg }),

    stall_term: ($) => makeTerm($.stall, { microseconds: $.term_arg }),

    store_symbolic_term: ($) =>
      prec.left(
        prec.right(
          seq(
            field("destination", $.super_name),
            "=",
            field("source", $.term_arg),
          ),
        ),
      ),

    store_term: ($) =>
      makeTerm($.store, { source: $.term_arg, destination: $.super_name }),

    subtract_compound_term: ($) =>
      prec.right(
        seq(
          field("minuend_result", $.term_arg),
          "-=",
          field("subtrahend", $.term_arg),
        ),
      ),

    subtract_symbolic_term: ($) =>
      prec.left(
        seq(field("minuend", $.term_arg), "-", field("subtrahend", $.term_arg)),
      ),

    subtract_term: ($) =>
      makeTerm($.subtract, {
        minuend: $.term_arg,
        subtrahend: $.term_arg,
        result: optional($.target),
      }),

    switch_term: ($) =>
      makeTerm(
        $.switch,
        { predicate: $.term_arg },
        { case_term_list: optional($.case_term_list) },
      ),

    thermal_zone_term: ($) =>
      makeTerm(
        $.thermal_zone,
        { thermal_zone_name: $.name_string },
        { term_list: optional($.term_list) },
      ),

    timer_term: ($) => $.timer,

    to_bcd_term: ($) =>
      makeTerm($.to_bcd, { value: $.term_arg, result: optional($.target) }),

    to_buffer_term: ($) =>
      makeTerm($.to_buffer, { data: $.term_arg, result: optional($.target) }),

    to_decimal_string_term: ($) =>
      makeTerm($.to_decimal_string, {
        data: $.term_arg,
        result: optional($.target),
      }),

    to_hex_string_term: ($) =>
      makeTerm($.to_hex_string, {
        data: $.term_arg,
        result: optional($.target),
      }),

    to_integer_term: ($) =>
      makeTerm($.to_integer, { data: $.term_arg, result: optional($.target) }),

    to_pld_term: ($) =>
      makeTerm($.to_pld, { pld_keyword_list: optional($.pld_keyword_list) }),

    to_string_term: ($) =>
      makeTerm($.to_string, {
        source: $.term_arg,
        length: optional($.term_arg),
        result: optional($.target),
      }),

    to_uuid_term: ($) => makeTerm($.to_uuid, { string: $.string_data }),

    unicode_term: ($) => makeTerm($.unicode, { string: $.string_data }),

    unload_term: ($) => makeTerm($.unload, { ddb_handle: $.super_name }),

    wait_term: ($) =>
      makeTerm($.wait, {
        sync_object: $.super_name,
        timeout_value: $.term_arg,
      }),

    while_term: ($) =>
      makeTerm(
        $.while,
        { predicate: $.term_arg },
        { term_list: optional($.term_list) },
      ),

    xor_compound_term: ($) =>
      prec.right(
        seq(
          field("source1_result", $.term_arg),
          "^=",
          field("source2", $.term_arg),
        ),
      ),

    xor_symbolic_term: ($) =>
      prec.left(
        seq(field("source1", $.term_arg), "^", field("source2", $.term_arg)),
      ),

    xor_term: ($) =>
      makeTerm($.xor, {
        source1: $.term_arg,
        source2: $.term_arg,
        result: optional($.target),
      }),

    // 19.2.7 ASL Parameter Keyword Terms
    // Most of this was generated from a web scraping of uefi.org that i did
    access_attrib_keyword: ($) =>
      choice(
        /AttribQuick/i,
        /AttribSendReceive/i,
        /AttribByte/i,
        // AttribBytes, AttribRawBytes, and AttribRawProcessBytes and handled by extended_access_attrib_keyword
        /AttribWord/i,
        /AttribBlock/i,
        /AttribProcessCall/i,
        /AttribBlockProcessCall/i,
      ),

    access_type_keyword: (_) =>
      choice(
        /AnyAcc/i,
        /ByteAcc/i,
        /WordAcc/i,
        /DWordAcc/i,
        /QWordAcc/i,
        /BufferAcc/i,
      ),
    address_keyword: (_) =>
      choice(
        /AddressRangeMemory/i,
        /AddressRangeReserved/i,
        /AddressRangeNVS/i,
        /AddressRangeACPI/i,
      ),
    address_space_keyword: ($) => choice($.region_space_keyword, /FFixedHW/i),
    addressing_mode_keyword: (_) =>
      choice(/AddressingMode7Bit/i, /AddressingMode10Bit/i),
    bus_master_keyword: (_) => choice(/BusMaster/i, /NotBusMaster/i),
    clock_phase_keyword: (_) => choice(/ClockPhaseFirst/i, /ClockPhaseSecond/i),
    clock_polarity_keyword: (_) =>
      choice(/ClockPolarityLow/i, /ClockPolarityHigh/i),
    // NOTE: renamed from byte_length_keyword to match the grammar in UARTSerialBusTerm
    data_bits_keyword: (_) =>
      choice(
        /DataBitsFive/i,
        /DataBitsSix/i,
        /DataBitsSeven/i,
        /DataBitsEight/i,
        /DataBitsNine/i,
      ),
    decode_keyword: (_) => choice(/SubDecode/i, /PosDecode/i),
    // NOTE: this was missing from the grammar definition so i wrote it from referencing 19.6.33
    dma_type_keyword: (_) =>
      choice(/Compatibility/i, /TypeA/i, /TypeB/i, /TypeF/i),
    // NOTE: changed from endian_keyword to match the rest of the grammar
    endianess_keyword: (_) => choice(/BigEndianing/i, /LittleEndian/i),
    extended_access_attrib_keyword: (_) =>
      choice(/AttribBytes/i, /AttribRawBytes/i, /AttribRawProcessBytes/i),
    flow_control_keyword: (_) =>
      choice(/FlowControlNone/i, /FlowControlXon/i, /FlowControlHardware/i),
    interrupt_type_keyword: (_) => choice(/Edge/i, /Level/i),
    interrupt_level: (_) => choice(/ActiveHigh/i, /ActiveLow/i),
    interrupt_level_keyword: (_) =>
      choice(/ActiveHigh/i, /ActiveLow/i, /ActiveBoth/i),
    io_decode_keyword: (_) => choice(/Decode16/i, /Decode10/i),
    io_restriction_keyword: (_) =>
      choice(
        /IoRestrictionNone/i,
        /IoRestrictionInputOnly/i,
        /IoRestrictionOutputOnly/i,
        /IoRestrictionNoneAndPreserve/i,
      ),
    lock_rule_keyword: (_) => choice(/Lock/i, /NoLock/i),
    match_op_keyword: (_) =>
      choice(/MTR/i, /MEQ/i, /MLE/i, /MLT/i, /MGE/i, /MGT/i),
    max_keyword: (_) => choice(/MaxFixed/i, /MaxNotFixed/i),
    mem_type_keyword: (_) =>
      choice(/Cacheable/i, /WriteCombining/i, /Prefetchable/i, /NonCacheable/i),
    min_keyword: (_) => choice(/MinFixed/i, /MinNotFixed/i),
    object_type_keyword: (_) =>
      choice(
        /UnknownObj/i,
        /IntObj/i,
        /StrObj/i,
        /BuffObj/i,
        /PkgObj/i,
        /FieldUnitObj/i,
        /DeviceObj/i,
        /EventObj/i,
        /MethodObj/i,
        /MutexObj/i,
        /OpRegionObj/i,
        /PowerResObj/i,
        /ThermalZoneObj/i,
        /BuffFieldObj/i,
      ),
    // NOTE: renamed from parity_keyword to match definition in UARTSerialBusTerm
    parity_type_keyword: (_) =>
      choice(
        /ParityTypeNone/i,
        /ParityTypeSpace/i,
        /ParityTypeMark/i,
        /ParityTypeOdd/i,
        /ParityTypeEven/i,
      ),
    pin_config_keyword: (_) =>
      choice(/PullDefault/i, /PullUp/i, /PullDown/i, /PullNone/i),
    // NOTE: renamed from polarity_keyword to match definition in SPISerialBusV2
    device_polarity_keyword: (_) => choice(/PolarityHigh/i, /PolarityLow/i),
    range_type_keyword: (_) =>
      choice(/ISAOnlyRanges/i, /NonISAOnlyRanges/i, /EntireRange/i),
    read_write_keyword: (_) => choice(/ReadWrite/i, /ReadOnly/i),
    region_space_keyword: (_) =>
      choice(
        /SystemIO/i,
        /SystemMemory/i,
        /PCI_Config/i,
        /EmbeddedControl/i,
        /SMBus/i,
        /SystemCMOS/i,
        /PciBarTarget/i,
        /IPMI/i,
        /GeneralPurposeIO/i,
        /GenericSerialBus/i,
        /PCC/i,
      ),
    resource_type_keyword: (_) =>
      choice(/ResourceConsumer/i, /ResourceProducer/i),
    serialize_rule_keyword: (_) => choice(/Serialized/i, /NotSerialized/i),
    share_type_keyword: (_) =>
      choice(/Shared/i, /Exclusive/i, /SharedAndWake/i, /ExclusiveAndWake/i),
    slave_mode_keyword: (_) =>
      choice(/ControllerInitiated/i, /DeviceInitiated/i),
    stop_bits_keyword: (_) =>
      choice(
        /StopBitsZero/i,
        /StopBitsOne/i,
        /StopBitsOnePlusHalf/i,
        /StopBitsTwo/i,
      ),
    transfer_width_keyword: (_) =>
      choice(
        /Width8Bit/i,
        /Width16Bit/i,
        /Width32Bit/i,
        /Width64Bit/i,
        /Width128Bit/i,
        /Width256Bit/i,
      ),
    translation_keyword: (_) =>
      choice(/SparseTranslation/i, /DenseTranslation/i),
    type_keyword: (_) => choice(/TypeTranslation/i, /TypeStatic/i),
    update_rule_keyword: (_) =>
      choice(/Preserve/i, /WriteAsOnes/i, /WriteAsZeros/i),
    user_def_region_space: ($) => $.integer_data,
    xfer_type_keyword: (_) =>
      choice(/Transfer8/i, /Transfer16/i, /Transfer8_16/i),
    wire_mode_keyword: (_) => choice(/ThreeWireMode/i, /FourWireMode/i),

    // 19.2.8 ASL Resource Template Terms
    // NOTE: this was also parsed from a web scraping. i went over it to fix obvious bugs but there may be some remaining
    // NOTE: this must be marked optional() in the parent
    resource_macro_list: ($) => repeat1(seq($.resource_macro_term)),
    resource_macro_term: ($) =>
      choice(
        $.dma_term,
        $.dword_io_term,
        $.dword_memory_term,
        $.dword_space_term,
        $.end_dependent_fn_term,
        $.extended_io_term,
        $.extended_memory_term,
        $.extended_space_term,
        $.fixed_dma_term,
        $.fixed_io_term,
        $.gpio_int_term,
        $.gpio_io_term,
        $.i2c_serial_bus_term,
        $.interrupt_term,
        $.io_term,
        $.irq_no_flags_term,
        $.irq_term,
        $.memory24_term,
        $.memory32_fixed_term,
        $.memory32_term,
        $.pin_config_term,
        $.pin_function_term,
        $.pin_group_term,
        $.pin_group_config_term,
        $.pin_group_function_term,
        $.qword_io_term,
        $.qword_memory_term,
        $.qword_space_term,
        $.register_term,
        $.spi_serial_bus_term,
        $.start_dependent_fn_term,
        $.start_dependent_fn_no_pri_term,
        $.uart_serial_bus_term,
        $.vendor_long_term,
        $.vendor_short_term,
        $.word_bus_number_term,
        $.word_io_term,
        $.word_space_term,
      ),

    dma_term: ($) =>
      makeTerm(
        $.dma,
        {
          dma_type: $.dma_type_keyword,
          bus_master: $.bus_master_keyword,
          xfer_type: $.xfer_type_keyword,
          descriptor_name: optional($.name_string),
        },
        { byte_list: optional($.byte_list) },
      ),

    dword_io_term: ($) =>
      makeTerm($.dword_io, {
        resource_usage: optional($.resource_type_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        decode: optional($.decode_keyword),
        range_type: optional($.range_type_keyword),
        address_granularity: $._dword_const_expr,
        min_address: $._dword_const_expr,
        max_address: $._dword_const_expr,
        address_translation: $._dword_const_expr,
        address_length: $._dword_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
        translation_type: optional($.type_keyword),
        translation_density: optional($.translation_keyword),
      }),

    dword_memory_term: ($) =>
      makeTerm($.dword_memory, {
        resource_usage: optional($.resource_type_keyword),
        decode: optional($.decode_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        mem_type: optional($.mem_type_keyword),
        read_write_type: $.read_write_keyword,
        address_granularity: $._dword_const_expr,
        min_address: $._dword_const_expr,
        max_address: $._dword_const_expr,
        address_translation: $._dword_const_expr,
        address_length: $._dword_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
        memory_range_type: optional($.address_keyword),
        translation_type: optional($.type_keyword),
      }),

    dword_space_term: ($) =>
      makeTerm($.dword_space, {
        resource_type: $._byte_const_expr,
        resource_usage: optional($.resource_type_keyword),
        decode: optional($.decode_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        type_specific_flags: $._byte_const_expr,
        address_granularity: $._dword_const_expr,
        min_address: $._dword_const_expr,
        max_address: $._dword_const_expr,
        address_translation: $._dword_const_expr,
        address_length: $._dword_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
      }),

    end_dependent_fn_term: ($) => seq($.end_dependent_fn, "(", ")"),

    extended_io_term: ($) =>
      makeTerm($.extended_io, {
        resource_usage: optional($.resource_type_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        decode: optional($.decode_keyword),
        range_type: optional($.range_type_keyword),
        address_granularity: $._qword_const_expr,
        min_address: $._qword_const_expr,
        max_address: $._qword_const_expr,
        address_translation: $._qword_const_expr,
        address_length: $._qword_const_expr,
        type_specific_attributes: optional($._qword_const_expr),
        descriptor_name: optional($.name_string),
        translation_type: optional($.type_keyword),
        translation_density: optional($.translation_keyword),
      }),

    extended_memory_term: ($) =>
      makeTerm($.extended_memory, {
        resource_usage: optional($.resource_type_keyword),
        decode: optional($.decode_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        mem_type: optional($.mem_type_keyword),
        read_write_type: $.read_write_keyword,
        address_granularity: $._qword_const_expr,
        min_address: $._qword_const_expr,
        max_address: $._qword_const_expr,
        address_translation: $._qword_const_expr,
        address_length: $._qword_const_expr,
        type_specific_attributes: optional($._qword_const_expr),
        descriptor_name: optional($.name_string),
        memory_range_type: optional($.address_keyword),
        translation_type: optional($.type_keyword),
      }),

    extended_space_term: ($) =>
      makeTerm($.extended_space, {
        resource_type: $._byte_const_expr,
        resource_usage: optional($.resource_type_keyword),
        decode: optional($.decode_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        type_specific_flags: $._byte_const_expr,
        address_granularity: $._qword_const_expr,
        min_address: $._qword_const_expr,
        max_address: $._qword_const_expr,
        address_translation: $._qword_const_expr,
        address_length: $._qword_const_expr,
        type_specific_attributes: optional($._qword_const_expr),
        descriptor_name: optional($.name_string),
      }),

    fixed_dma_term: ($) =>
      makeTerm($.fixed_dma, {
        dma_req: $._word_const_expr,
        channel: $._word_const_expr,
        xfer_width: optional($.transfer_width_keyword),
        descriptor_name: optional($.name_string),
      }),

    fixed_io_term: ($) =>
      makeTerm($.fixed_io, {
        address_base: $._word_const_expr,
        range_length: $._byte_const_expr,
        descriptor_name: optional($.name_string),
      }),

    gpio_int_term: ($) =>
      makeTerm(
        $.gpio_int,
        {
          interrupt_type: $.interrupt_type_keyword,
          interrupt_level: $.interrupt_level_keyword,
          share_type: optional($.share_type_keyword),
          pin_config: choice($.pin_config_keyword, $._byte_const_expr),
          de_bounce_time: optional($._word_const_expr),
          resource_source: $.string_data,
          resource_source_index: optional($._byte_const_expr),
          resource_usage: optional($.resource_type_keyword),
          descriptor_name: optional($.name_string),
          vendor_data: optional($.raw_data_buffer),
        },
        { dword_list: optional($.dword_list) },
      ),

    gpio_io_term: ($) =>
      makeTerm(
        $.gpio_io,
        {
          share_type: optional($.share_type_keyword),
          pin_config: choice($.pin_config_keyword, $._byte_const_expr),
          de_bounce_time: optional($._word_const_expr),
          drive_strength: optional($._word_const_expr),
          io_restriction: optional($.io_restriction_keyword),
          resource_source: $.string_data,
          resource_source_index: optional($._byte_const_expr),
          resource_usage: optional($.resource_type_keyword),
          descriptor_name: optional($.name_string),
          vendor_data: optional($.raw_data_buffer),
        },
        { dword_list: optional($.dword_list) },
      ),

    i2c_serial_bus_term: ($) =>
      makeTerm($.i2c_serial_bus_v2, {
        slave_address: $._word_const_expr,
        slave_mode: optional($.slave_mode_keyword),
        connection_speed: $._dword_const_expr,
        // WARN: the spec says "AddressModeKeyword" but i think thats a typo
        addressing_mode: optional($.addressing_mode_keyword),
        resource_source: $.string_data,
        resource_source_index: optional($._byte_const_expr),
        resource_usage: optional($.resource_type_keyword),
        descriptor_name: optional($.name_string),
        share_type: optional($.share_type_keyword),
        vendor_data: optional($.raw_data_buffer),
      }),

    interrupt_term: ($) =>
      makeTerm(
        $.interrupt,
        {
          resource_type: optional($.resource_type_keyword),
          interrupt_type: $.interrupt_type_keyword,
          interrupt_level: $.interrupt_level_keyword,
          share_type: optional($.share_type_keyword),
          resource_source_index: optional($._byte_const_expr),
          resource_source: optional($.string_data),
          descriptor_name: optional($.name_string),
        },
        { dword_list: optional($.dword_list) },
      ),

    io_term: ($) =>
      makeTerm($.io, {
        io_decode: $.io_decode_keyword,
        min_address: $._word_const_expr,
        max_address: $._word_const_expr,
        alignment: $._byte_const_expr,
        range_length: $._byte_const_expr,
        descriptor_name: optional($.name_string),
      }),

    irq_no_flags_term: ($) =>
      makeTerm(
        $.irq_no_flags,
        {
          descriptor_name: optional($.name_string),
        },
        { byte_list: optional($.byte_list) },
      ),

    irq_term: ($) =>
      makeTerm(
        $.irq,
        {
          interrupt_type: $.interrupt_type_keyword,
          interrupt_level: $.interrupt_level_keyword,
          share_type: optional($.share_type_keyword),
          descriptor_name: optional($.name_string),
        },
        { byte_list: optional($.byte_list) },
      ),

    memory24_term: ($) =>
      makeTerm($.memory24, {
        read_write_type: $.read_write_keyword,
        // NOTE: spec says [23:8] which im ignoring
        min_address: $._word_const_expr,
        max_address: $._word_const_expr,
        alignment: $._word_const_expr,
        range_length: $._word_const_expr,
        descriptor_name: optional($.name_string),
      }),

    memory32_fixed_term: ($) =>
      makeTerm($.memory32_fixed, {
        read_write_type: $.read_write_keyword,
        address_base: $._dword_const_expr,
        range_length: $._dword_const_expr,
        descriptor_name: optional($.name_string),
      }),

    memory32_term: ($) =>
      makeTerm($.memory32, {
        read_write_type: $.read_write_keyword,
        min_address: $._dword_const_expr,
        max_address: $._dword_const_expr,
        alignment: $._dword_const_expr,
        range_length: $._dword_const_expr,
        descriptor_name: optional($.name_string),
      }),

    pin_config_term: ($) =>
      makeTerm(
        $.pin_config,
        {
          share_type: optional($.share_type_keyword),
          // NOTE: the spec shows this field as ByteData but i think thats a mistake
          pin_config_type: $._byte_const_expr,
          // NOTE: the spec shows this field as ByteData but i think thats a mistake
          pin_config_value: $._byte_const_expr,
          resource_source: $.string_data,
          resource_source_index: optional($._byte_const_expr),
          resource_usage: optional($.resource_type_keyword),
          descriptor_name: optional($.name_string),
          vendor_data: optional($.raw_data_buffer),
        },
        { dword_list: optional($.dword_list) },
      ),

    pin_function_term: ($) =>
      makeTerm(
        $.pin_function,
        {
          share_type: optional($.share_type_keyword),
          pin_pull_configuration: $.pin_config_keyword,
          // NOTE: the spec shows this field as WordData but i think thats a mistake
          function_number: $._word_const_expr,
          resource_source: $.string_data,
          resource_source_index: optional($._byte_const_expr),
          resource_usage: optional($.resource_type_keyword),
          descriptor_name: optional($.name_string),
          vendor_data: optional($.raw_data_buffer),
        },
        { dword_list: optional($.dword_list) },
      ),

    pin_group_term: ($) =>
      makeTerm(
        $.pin_group,
        {
          resource_label: $.string_data,
          resource_usage: optional($.resource_type_keyword),
          descriptor_name: optional($.name_string),
          vendor_data: optional($.raw_data_buffer),
        },
        { dword_list: optional($.dword_list) },
      ),

    pin_group_config_term: ($) =>
      makeTerm($.pin_group_config, {
        share_type: optional($.share_type_keyword),
        // NOTE: the spec shows this field as ByteData but i think thats a mistake
        pin_config_type: $._byte_const_expr,
        // NOTE: the spec shows this field as ByteData but i think thats a mistake
        pin_config_value: $._byte_const_expr,
        resource_source: $.string_data,
        resource_source_index: optional($._byte_const_expr),
        resource_source_label: $.string_data,
        resource_usage: optional($.resource_type_keyword),
        descriptor_name: optional($.name_string),
        vendor_data: optional($.raw_data_buffer),
      }),

    pin_group_function_term: ($) =>
      makeTerm($.pin_group_function, {
        share_type: optional($.share_type_keyword),
        // NOTE: the spec shows this field as WordData but i think thats a mistake
        function_number: $._word_const_expr,
        resource_source: $.string_data,
        resource_source_index: optional($._byte_const_expr),
        resource_source_label: $.string_data,
        resource_usage: optional($.resource_type_keyword),
        descriptor_name: optional($.name_string),
        vendor_data: optional($.raw_data_buffer),
      }),

    qword_io_term: ($) =>
      makeTerm($.qword_io, {
        resource_usage: optional($.resource_type_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        decode: optional($.decode_keyword),
        range_type: optional($.range_type_keyword),
        address_granularity: $._qword_const_expr,
        min_address: $._qword_const_expr,
        max_address: $._qword_const_expr,
        address_translation: $._qword_const_expr,
        address_length: $._qword_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
        translation_type: optional($.type_keyword),
        translation_density: optional($.translation_keyword),
      }),

    qword_memory_term: ($) =>
      makeTerm($.qword_memory, {
        resource_usage: optional($.resource_type_keyword),
        decode: optional($.decode_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        mem_type: optional($.mem_type_keyword),
        read_write_type: $.read_write_keyword,
        address_granularity: $._qword_const_expr,
        min_address: $._qword_const_expr,
        max_address: $._qword_const_expr,
        address_translation: $._qword_const_expr,
        address_length: $._qword_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
        memory_range_type: optional($.address_keyword),
        translation_type: optional($.type_keyword),
      }),

    qword_space_term: ($) =>
      makeTerm($.qword_space, {
        resource_type: $._byte_const_expr,
        resource_usage: optional($.resource_type_keyword),
        decode: optional($.decode_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        type_specific_flags: $._byte_const_expr,
        address_granularity: $._qword_const_expr,
        min_address: $._qword_const_expr,
        max_address: $._qword_const_expr,
        address_translation: $._qword_const_expr,
        address_length: $._qword_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
      }),

    register_term: ($) =>
      makeTerm($.register, {
        address_space_id: $.address_space_keyword,
        register_bit_width: $._byte_const_expr,
        register_offset: $._byte_const_expr,
        register_address: $._qword_const_expr,
        access_size: $._byte_const_expr,
        descriptor_name: optional($.name_string),
      }),

    spi_serial_bus_term: ($) =>
      makeTerm($.spi_serial_bus_v2, {
        device_selection: $._word_const_expr,
        device_selection_polarity: optional($.device_polarity_keyword),
        wire_mode: optional($.wire_mode_keyword),
        data_bit_length: $._byte_const_expr,
        slave_mode: optional($.slave_mode_keyword),
        connection_speed: $._dword_const_expr,
        clock_polarity: $.clock_polarity_keyword,
        clock_phase: $.clock_phase_keyword,
        resource_source: $.string_data,
        resource_source_index: optional($._byte_const_expr),
        resource_usage: optional($.resource_type_keyword),
        descriptor_name: optional($.name_string),
        share_type: optional($.share_type_keyword),
        vendor_data: optional($.raw_data_buffer),
      }),

    start_dependent_fn_no_pri_term: ($) =>
      makeTerm(
        $.start_dependent_fn_no_pri,
        {},
        { resource_macro_list: optional($.resource_macro_list) },
      ),

    start_dependent_fn_term: ($) =>
      makeTerm(
        $.start_dependent_fn,
        {
          compat_priority: $._byte_const_expr,
          perf_robust_priority: $._byte_const_expr,
        },
        { resource_macro_list: optional($.resource_macro_list) },
      ),

    uart_serial_bus_term: ($) =>
      makeTerm($.uart_serial_bus_v2, {
        initial_baudrate: $._dword_const_expr,
        bits_per_byte: optional($.data_bits_keyword),
        stop_bits: optional($.stop_bits_keyword),
        lines_in_use: $._byte_const_expr,
        is_big_endian: optional($.endianess_keyword),
        parity: optional($.parity_type_keyword),
        flow_control: optional($.flow_control_keyword),
        receive_buffer_size: $._word_const_expr,
        transmit_buffer_size: $._word_const_expr,
        resource_source: $.string_data,
        resource_source_index: optional($._byte_const_expr),
        resource_usage: optional($.resource_type_keyword),
        descriptor_name: optional($.name_string),
        share_type: optional($.share_type_keyword),
        vendor_data: optional($.object),
      }),

    vendor_long_term: ($) =>
      makeTerm(
        $.vendor_long,
        {
          descriptor_name: optional($.name_string),
        },
        { byte_list: optional($.byte_list) },
      ),

    vendor_short_term: ($) =>
      makeTerm(
        $.vendor_short,
        {
          descriptor_name: optional($.name_string),
        },
        { byte_list: optional($.byte_list) },
      ),

    word_bus_number_term: ($) =>
      makeTerm($.word_bus_number, {
        resource_usage: optional($.resource_type_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        decode: optional($.decode_keyword),
        address_granularity: $._word_const_expr,
        min_address: $._word_const_expr,
        max_address: $._word_const_expr,
        address_translation: $._word_const_expr,
        address_length: $._word_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
      }),

    word_io_term: ($) =>
      makeTerm($.word_io, {
        resource_usage: optional($.resource_type_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        decode: optional($.decode_keyword),
        range_type: optional($.range_type_keyword),
        address_granularity: $._word_const_expr,
        min_address: $._word_const_expr,
        max_address: $._word_const_expr,
        address_translation: $._word_const_expr,
        address_length: $._word_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
        translation_type: optional($.type_keyword),
        translation_density: optional($.translation_keyword),
      }),

    word_space_term: ($) =>
      makeTerm($.word_space, {
        resource_type: $._byte_const_expr,
        resource_usage: optional($.resource_type_keyword),
        decode: optional($.decode_keyword),
        min_type: optional($.min_keyword),
        max_type: optional($.max_keyword),
        type_specific_flags: $._byte_const_expr,
        address_granularity: $._word_const_expr,
        min_address: $._word_const_expr,
        max_address: $._word_const_expr,
        address_translation: $._word_const_expr,
        address_length: $._word_const_expr,
        resource_source_index: optional($._byte_const_expr),
        resource_source: optional($.string_data),
        descriptor_name: optional($.name_string),
      }),

    // ASL Operators (all case insensitive)
    // Table 19.16 ASL compiler controls
    external: (_) => /External/i,
    include: (_) => /Include/i,
    // Table 19.17 ACPI table management
    definition_block: (_) => /DefinitionBlock/i,
    load_table: (_) => /LoadTable/i,
    load: (_) => /Load/i,
    // Table 19.18 Miscellaneous named object creation
    alias: (_) => /Alias/i,
    buffer: (_) => /Buffer/i,
    device: (_) => /Device/i,
    function: (_) => /Function/i,
    method: (_) => /Method/i,
    name: (_) => /Name/i,
    package: (_) => /Package/i,
    power_resource: (_) => /PowerResource/i,
    processor: (_) => /Processor/i,
    raw_data_buffer: (_) => /RawDataBuffer/i,
    scope: (_) => /Scope/i,
    thermal_zone: (_) => /ThermalZone/i,
    // Table 19.19 Operation Regions and Fields
    access_as: (_) => /AccessAs/i,
    bank_field: (_) => /BankField/i,
    connection: (_) => /Connection/i,
    data_table_region: (_) => /DataTableRegion/i,
    field: (_) => /Field/i,
    index_field: (_) => /IndexField/i,
    offset: (_) => /Offset/i,
    operation_region: (_) => /OperationRegion/i,
    // Table 19.20 Buffer Fields
    create_bit_field: (_) => /CreateBitField/i,
    create_byte_field: (_) => /CreateByteField/i,
    create_dword_field: (_) => /CreateDWordField/i,
    create_field: (_) => /CreateField/i,
    create_qword_field: (_) => /CreateQWordField/i,
    create_word_field: (_) => /CreateWordField/i,
    // Table 19.21 Synchronization
    acquire: (_) => /Acquire/i,
    event: (_) => /Event/i,
    mutex: (_) => /Mutex/i,
    notify: (_) => /Notify/i,
    release: (_) => /Release/i,
    reset: (_) => /Reset/i,
    signal: (_) => /Signal/i,
    wait: (_) => /Wait/i,
    unload: (_) => /Unload/i, // this table is missing Unload so i added it
    // Table 19.22 Object references
    cond_ref_of: (_) => /CondRefOf/i,
    deref_of: (_) => /DerefOf/i,
    ref_of: (_) => /RefOf/i,
    // Table 19.23 Integer arithmetic
    add: (_) => /Add/i,
    and: (_) => /And/i,
    decrement: (_) => /Decrement/i,
    divide: (_) => /Divide/i,
    find_set_left_bit: (_) => /FindSetLeftBit/i,
    find_set_right_bit: (_) => /FindSetRightBit/i,
    increment: (_) => /Increment/i,
    mod: (_) => /Mod/i,
    multiply: (_) => /Multiply/i,
    n_and: (_) => /NAnd/i,
    n_or: (_) => /NOr/i,
    not: (_) => /Not/i,
    or: (_) => /Or/i,
    shift_left: (_) => /ShiftLeft/i,
    shift_right: (_) => /ShiftRight/i,
    subtract: (_) => /Subtract/i,
    xor: (_) => /Xor/i,
    // Table 19.24 Logical operators
    l_and: (_) => /LAnd/i,
    l_equal: (_) => /LEqual/i,
    l_greater: (_) => /LGreater/i,
    l_greater_equal: (_) => /LGreaterEqual/i,
    l_less: (_) => /LLess/i,
    l_less_equal: (_) => /LLessEqual/i,
    l_not: (_) => /LNot/i,
    l_not_equal: (_) => /LNotEqual/i,
    l_or: (_) => /LOr/i,
    // Table 19.25 Method execution control
    break: (_) => /Break/i,
    break_point: (_) => /BreakPoint/i,
    case: (_) => /Case/i,
    continue: (_) => /Continue/i,
    default: (_) => /Default/i,
    else: (_) => /Else/i,
    else_if: (_) => /ElseIf/i,
    fatal: (_) => /Fatal/i,
    if: (_) => /If/i,
    no_op: (_) => /NoOp/i,
    return: (_) => /Return/i,
    sleep: (_) => /Sleep/i,
    stall: (_) => /Stall/i,
    switch: (_) => /Switch/i,
    while: (_) => /While/i,
    for: (_) => /For/i, // this table is missing For so i added it
    // Table 19.26 Data type conversion and manipulation
    concatenate: (_) => /Concatenate/i,
    copy_object: (_) => /CopyObject/i,
    debug: (_) => /Debug/i,
    eisa_id: (_) => /EisaId/i,
    fprintf: (_) => /Fprintf/i,
    from_bcd: (_) => /FromBCD/i,
    index: (_) => /Index/i,
    match: (_) => /Match/i,
    mid: (_) => /Mid/i,
    object_type: (_) => /ObjectType/i,
    printf: (_) => /Printf/i,
    size_of: (_) => /SizeOf/i,
    store: (_) => /Store/i,
    timer: (_) => /Timer/i,
    to_bcd: (_) => /ToBCD/i,
    to_buffer: (_) => /ToBuffer/i,
    to_decimal_string: (_) => /ToDecimalString/i,
    to_hex_string: (_) => /ToHexString/i,
    to_integer: (_) => /ToInteger/i,
    to_pld: (_) => /ToPLD/i,
    to_string: (_) => /ToString/i,
    to_uuid: (_) => /ToUUID/i,
    unicode: (_) => /Unicode/i,
    // Table 19.27 Resource Descriptor macros
    concatenate_res_template: (_) => /ConcatenateResTemplate/i,
    dma: (_) => /DMA/i,
    dword_io: (_) => /DWordIO/i,
    dword_memory: (_) => /DWordMemory/i,
    dword_space: (_) => /DWordSpace/i,
    end_dependent_fn: (_) => /EndDependentFn/i,
    extended_io: (_) => /ExtendedIO/i,
    extended_memory: (_) => /ExtendedMemory/i,
    extended_space: (_) => /ExtendedSpace/i,
    fixed_dma: (_) => /FixedDMA/i,
    fixed_io: (_) => /FixedIO/i,
    gpio_int: (_) => /GpioInt/i,
    gpio_io: (_) => /GpioIO/i,
    i2c_serial_bus_v2: (_) => /I2CSerialBusV2/i,
    interrupt: (_) => /Interrupt/i,
    io: (_) => /IO/i,
    irq: (_) => /IRQ/i,
    irq_no_flags: (_) => /IRQNoFlags/i,
    memory24: (_) => /Memory24/i,
    memory32: (_) => /Memory32/i,
    memory32_fixed: (_) => /Memory32Fixed/i,
    qword_io: (_) => /QWordIO/i,
    qword_memory: (_) => /QWordMemory/i,
    qword_space: (_) => /QWordSpace/i,
    register: (_) => /Register/i,
    resource_template: (_) => /ResourceTemplate/i,
    spi_serial_bus_v2: (_) => /SPISerialBusV2/i,
    start_dependent_fn: (_) => /StartDependentFn/i,
    start_dependent_fn_no_pri: (_) => /StartDependentFnNoPri/i,
    uart_serial_bus_v2: (_) => /UARTSerialBusV2/i,
    vendor_long: (_) => /VendorLong/i,
    vendor_short: (_) => /VendorShort/i,
    word_bus_number: (_) => /WordBusNumber/i,
    word_io: (_) => /WordIO/i,
    word_space: (_) => /WordSpace/i,
    // Table 19.28 Constants
    one: (_) => /One/i,
    ones: (_) => /Ones/i,
    revision: (_) => /Revision/i,
    zero: (_) => /Zero/i,
    // Pin* functions aren't in tables:
    pin_config: (_) => /PinConfig/i,
    pin_function: (_) => /PinFunction/i,
    pin_group: (_) => /PinGroup/i,
    pin_group_config: (_) => /PinGroupConfig/i,
    pin_group_function: (_) => /PinGroupFunction/i,

    // this needs to be last because treesitter matches based on defintion order sometimes.
    // Keywords like `Name` and name_seg could both match at the same time, and we want name_seg
    // to have less precedence
    name_seg: (_) => /[A-Za-z_][0-9A-Za-z_]{0,3}/,
  },
});

// inject makeTerm helper methods into grammar
// we need to call each grammar before passing to treesitter method since they're dynamically generated
// there might be a much better way to do this but i give up for now
const proxy = new Proxy(Object, {
  get: (_target, prop, _receiver) => sym(String(prop)),
});
// @ts-ignore
for (const fn of Object.values(grammarMap.rules)) fn(proxy);
Object.assign(grammarMap.rules, termHelperRules);

export default grammar(grammarMap);
