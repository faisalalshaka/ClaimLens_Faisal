export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      claims: {
        Row: {
          accident_date: string
          active_review_seconds: number
          agent_notes: string
          ai_line_items: Json
          ai_result: Json | null
          approved_at: string | null
          assigned_agent: string
          created_at: string
          description: string
          id: string
          line_items: Json
          photo_request_reason: string | null
          photos: Json
          policy_number: string
          policyholder: string
          rejection_reason: string | null
          review_started_at: string | null
          status: string
          submitted_at: string | null
          updated_at: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: number
        }
        Insert: {
          accident_date: string
          active_review_seconds?: number
          agent_notes?: string
          ai_line_items?: Json
          ai_result?: Json | null
          approved_at?: string | null
          assigned_agent?: string
          created_at?: string
          description?: string
          id: string
          line_items?: Json
          photo_request_reason?: string | null
          photos?: Json
          policy_number: string
          policyholder: string
          rejection_reason?: string | null
          review_started_at?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          vehicle_make: string
          vehicle_model: string
          vehicle_year: number
        }
        Update: {
          accident_date?: string
          active_review_seconds?: number
          agent_notes?: string
          ai_line_items?: Json
          ai_result?: Json | null
          approved_at?: string | null
          assigned_agent?: string
          created_at?: string
          description?: string
          id?: string
          line_items?: Json
          photo_request_reason?: string | null
          photos?: Json
          policy_number?: string
          policyholder?: string
          rejection_reason?: string | null
          review_started_at?: string | null
          status?: string
          submitted_at?: string | null
          updated_at?: string
          vehicle_make?: string
          vehicle_model?: string
          vehicle_year?: number
        }
        Relationships: []
      }
      demo_claims_snapshot: {
        Row: {
          accident_date: string | null
          active_review_seconds: number
          agent_notes: string | null
          ai_line_items: Json | null
          ai_result: Json | null
          approved_at: string | null
          assigned_agent: string
          created_at: string | null
          description: string | null
          id: string
          line_items: Json | null
          photo_request_reason: string | null
          photos: Json | null
          policy_number: string | null
          policyholder: string | null
          rejection_reason: string | null
          review_started_at: string | null
          status: string | null
          submitted_at: string | null
          updated_at: string | null
          vehicle_make: string | null
          vehicle_model: string | null
          vehicle_year: number | null
        }
        Insert: {
          accident_date?: string | null
          active_review_seconds?: number
          agent_notes?: string | null
          ai_line_items?: Json | null
          ai_result?: Json | null
          approved_at?: string | null
          assigned_agent?: string
          created_at?: string | null
          description?: string | null
          id: string
          line_items?: Json | null
          photo_request_reason?: string | null
          photos?: Json | null
          policy_number?: string | null
          policyholder?: string | null
          rejection_reason?: string | null
          review_started_at?: string | null
          status?: string | null
          submitted_at?: string | null
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Update: {
          accident_date?: string | null
          active_review_seconds?: number
          agent_notes?: string | null
          ai_line_items?: Json | null
          ai_result?: Json | null
          approved_at?: string | null
          assigned_agent?: string
          created_at?: string | null
          description?: string | null
          id?: string
          line_items?: Json | null
          photo_request_reason?: string | null
          photos?: Json | null
          policy_number?: string | null
          policyholder?: string | null
          rejection_reason?: string | null
          review_started_at?: string | null
          status?: string | null
          submitted_at?: string | null
          updated_at?: string | null
          vehicle_make?: string | null
          vehicle_model?: string | null
          vehicle_year?: number | null
        }
        Relationships: []
      }
      repair_costs: {
        Row: {
          action: string
          labor_hours: number
          paint_materials_cost: number
          part: string
          parts_cost: number
          severity: string
        }
        Insert: {
          action: string
          labor_hours: number
          paint_materials_cost: number
          part: string
          parts_cost: number
          severity: string
        }
        Update: {
          action?: string
          labor_hours?: number
          paint_materials_cost?: number
          part?: string
          parts_cost?: number
          severity?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      reset_demo: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
