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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activities: {
        Row: {
          body: string | null
          client_id: string
          created_at: string
          created_by: string | null
          id: string
          meta: Json
          title: string
          type: string
        }
        Insert: {
          body?: string | null
          client_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          meta?: Json
          title: string
          type: string
        }
        Update: {
          body?: string | null
          client_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          meta?: Json
          title?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "activities_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      call_logs: {
        Row: {
          client_id: string | null
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["msg_direction"]
          duration_seconds: number
          from_number: string | null
          id: string
          outcome_notes: string | null
          provider: string | null
          provider_call_id: string | null
          status: string
          to_number: string | null
        }
        Insert: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"]
          duration_seconds?: number
          from_number?: string | null
          id?: string
          outcome_notes?: string | null
          provider?: string | null
          provider_call_id?: string | null
          status?: string
          to_number?: string | null
        }
        Update: {
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"]
          duration_seconds?: number
          from_number?: string | null
          id?: string
          outcome_notes?: string | null
          provider?: string | null
          provider_call_id?: string | null
          status?: string
          to_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_logs_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["msg_channel"]
          created_at: string
          created_by: string | null
          failed_count: number
          id: string
          name: string
          recipient_count: number
          sent_count: number
          status: string
          subject: string | null
        }
        Insert: {
          body: string
          channel: Database["public"]["Enums"]["msg_channel"]
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          name: string
          recipient_count?: number
          sent_count?: number
          status?: string
          subject?: string | null
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["msg_channel"]
          created_at?: string
          created_by?: string | null
          failed_count?: number
          id?: string
          name?: string
          recipient_count?: number
          sent_count?: number
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          assigned_to: string | null
          company: string | null
          created_at: string
          created_by: string | null
          deal_value: number
          email: string | null
          email_opted_out: boolean
          id: string
          last_contacted_at: string | null
          name: string
          notes: string | null
          phone: string | null
          sms_opted_out: boolean
          source: string | null
          status: Database["public"]["Enums"]["deal_status"]
          tags: string[]
          updated_at: string
          whatsapp: string | null
        }
        Insert: {
          assigned_to?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          deal_value?: number
          email?: string | null
          email_opted_out?: boolean
          id?: string
          last_contacted_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          sms_opted_out?: boolean
          source?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          tags?: string[]
          updated_at?: string
          whatsapp?: string | null
        }
        Update: {
          assigned_to?: string | null
          company?: string | null
          created_at?: string
          created_by?: string | null
          deal_value?: number
          email?: string | null
          email_opted_out?: boolean
          id?: string
          last_contacted_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          sms_opted_out?: boolean
          source?: string | null
          status?: Database["public"]["Enums"]["deal_status"]
          tags?: string[]
          updated_at?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          client_id: string
          created_at: string
          id: string
          mime_type: string | null
          name: string
          size_bytes: number
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          mime_type?: string | null
          name: string
          size_bytes?: number
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          mime_type?: string | null
          name?: string
          size_bytes?: number
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string
          campaign_id: string | null
          channel: Database["public"]["Enums"]["msg_channel"]
          clicked_at: string | null
          client_id: string | null
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["msg_direction"]
          error: string | null
          from_address: string | null
          id: string
          opened_at: string | null
          provider: string | null
          provider_message_id: string | null
          status: string
          subject: string | null
          to_address: string | null
        }
        Insert: {
          body: string
          campaign_id?: string | null
          channel: Database["public"]["Enums"]["msg_channel"]
          clicked_at?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"]
          error?: string | null
          from_address?: string | null
          id?: string
          opened_at?: string | null
          provider?: string | null
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
        }
        Update: {
          body?: string
          campaign_id?: string | null
          channel?: Database["public"]["Enums"]["msg_channel"]
          clicked_at?: string | null
          client_id?: string | null
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["msg_direction"]
          error?: string | null
          from_address?: string | null
          id?: string
          opened_at?: string | null
          provider?: string | null
          provider_message_id?: string | null
          status?: string
          subject?: string | null
          to_address?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      status_history: {
        Row: {
          changed_by: string | null
          client_id: string
          created_at: string
          from_status: Database["public"]["Enums"]["deal_status"] | null
          id: string
          to_status: Database["public"]["Enums"]["deal_status"]
        }
        Insert: {
          changed_by?: string | null
          client_id: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["deal_status"] | null
          id?: string
          to_status: Database["public"]["Enums"]["deal_status"]
        }
        Update: {
          changed_by?: string | null
          client_id?: string
          created_at?: string
          from_status?: Database["public"]["Enums"]["deal_status"] | null
          id?: string
          to_status?: Database["public"]["Enums"]["deal_status"]
        }
        Relationships: [
          {
            foreignKeyName: "status_history_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assigned_to: string | null
          client_id: string | null
          completed: boolean
          created_at: string
          created_by: string | null
          due_at: string | null
          id: string
          notes: string | null
          title: string
        }
        Insert: {
          assigned_to?: string | null
          client_id?: string | null
          completed?: boolean
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          title: string
        }
        Update: {
          assigned_to?: string | null
          client_id?: string | null
          completed?: boolean
          created_at?: string
          created_by?: string | null
          due_at?: string | null
          id?: string
          notes?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          body: string
          channel: Database["public"]["Enums"]["msg_channel"]
          created_at: string
          created_by: string | null
          id: string
          name: string
          subject: string | null
          updated_at: string
        }
        Insert: {
          body: string
          channel?: Database["public"]["Enums"]["msg_channel"]
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
          subject?: string | null
          updated_at?: string
        }
        Update: {
          body?: string
          channel?: Database["public"]["Enums"]["msg_channel"]
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          subject?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "sales_rep"
      deal_status:
        | "lead"
        | "proposal_sent"
        | "negotiating"
        | "working_with_client"
        | "follow_up_needed"
        | "on_hold"
        | "accepted"
        | "rejected"
      msg_channel: "email" | "sms" | "whatsapp" | "call"
      msg_direction: "outbound" | "inbound"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "sales_rep"],
      deal_status: [
        "lead",
        "proposal_sent",
        "negotiating",
        "working_with_client",
        "follow_up_needed",
        "on_hold",
        "accepted",
        "rejected",
      ],
      msg_channel: ["email", "sms", "whatsapp", "call"],
      msg_direction: ["outbound", "inbound"],
    },
  },
} as const
